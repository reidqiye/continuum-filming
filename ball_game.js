"use strict";

//ball setting
// 数值使用 SVG 坐标单位，不是屏幕像素。
let ballSettings = {
  radius: 18,
  moveSpeed: 45,
  breakDistance: 170,
  ballStretchMax: 0.05,
  ballSpring: 230,
  ballDamping: 10,
  shiftFollowSpring: 220,
  shiftFollowDamping: 26,
  shiftFollowMaxLag: 8,
};

//SVG elements
let ballPlayfield = document.querySelector("#ballPlayfield");
let ballLinks = document.querySelector("#ballLinks");
let ballCircles = document.querySelector("#ballCircles");
let ballStatus = document.querySelector("#ballStatus");
let ballSvgNamespace = "http://www.w3.org/2000/svg";

//game state
let gameBalls = [];
let gameLinks = [];
let ballDrag = null;
let shiftFollow = null;
let ballGameActive = false;
let ballFrameId = null;
let previousBallTime = null;

//find ball
function getBallById(id) {
  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];

    if (b.id === id) {
      return b;
    }
  }
}

//find saved position
function getBallOrigin(origins, id) {
  for (let i = 0; i < origins.length; i++) {
    let origin = origins[i];

    if (origin.id === id) {
      return origin;
    }
  }
}

//group bounds
function getBallBounds(group) {
  let bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };

  for (let i = 0; i < group.length; i++) {
    let b = group[i];
    bounds.minX = Math.min(bounds.minX, b.x);
    bounds.maxX = Math.max(bounds.maxX, b.x);
    bounds.minY = Math.min(bounds.minY, b.y);
    bounds.maxY = Math.max(bounds.maxY, b.y);
  }

  return bounds;
}

//reset
function resetBallGame() {
  endBallDrag();
  shiftFollow = null;

  if (typeof classificationActive !== "undefined" && classificationActive) {
    resetClassification();
    return;
  }

  //ball position
  gameBalls = [
    {
      id: 0,
      color: "B",
      x: 160,
      y: 300,
    },
    {
      id: 1,
      color: "W",
      x: 250,
      y: 300,
    },
    {
      id: 2,
      color: "B",
      x: 340,
      y: 300,
    },
  ];

  gameLinks = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ];

  ballLinks.replaceChildren();
  ballCircles.replaceChildren();

  //create links
  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];
    link.restDistance = 90;
    link.element = document.createElementNS(ballSvgNamespace, "line");
    link.element.setAttribute("class", "ballLink");
    ballLinks.appendChild(link.element);
  }

  //create balls
  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];
    b.stretch = 0;
    b.stretchVelocity = 0;
    b.stretchAngle = 0;
    b.element = document.createElementNS(ballSvgNamespace, "circle");
    b.element.setAttribute("r", ballSettings.radius);

    if (b.color === "B") {
      b.element.setAttribute("fill", "#181a17");
    } else {
      b.element.setAttribute("fill", "#fff");
    }

    b.element.setAttribute("class", "gameBall");
    b.element.dataset.ballId = b.id;
    ballCircles.appendChild(b.element);
  }

  previousBallTime = null;
  renderBallGame();
  updateBallStatus();
}

//status
function updateBallStatus() {
  if (typeof classificationActive !== "undefined" && classificationActive) {
    updateClassificationUI();
    return;
  }

  ballStatus.textContent =
    "Balls " + gameBalls.length + " · Links " + gameLinks.length +
    " · Links break when ball centers are more than " + ballSettings.breakDistance + " units apart.";
}

//draw balls and links
function renderBallGame() {
  let view = ballPlayfield.viewBox.baseVal;
  // 宽形 SVG 只改变投影；补偿球的横向外观，球心、拖拽和物理坐标不变。
  let shapeScale = ballPlayfield.height.baseVal.value * view.width /
    (ballPlayfield.width.baseVal.value * view.height);
  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];
    let firstBall = getBallById(link.from);
    let secondBall = getBallById(link.to);

    link.element.setAttribute("x1", firstBall.x);
    link.element.setAttribute("y1", firstBall.y);
    link.element.setAttribute("x2", secondBall.x);
    link.element.setAttribute("y2", secondBall.y);
  }

  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];
    b.element.setAttribute("cx", b.x);
    b.element.setAttribute("cy", b.y);

    //ball appearance
    // 只缩放外观，球心仍使用 x、y；两轴缩放互为倒数，保持面积。
    let room = Math.min(b.x, view.width - b.x, b.y, view.height - b.y) - 2;
    let maxScale = Math.max(1, room / ballSettings.radius);
    let stretch = Math.max(
      1 / maxScale - 1,
      Math.min(maxScale - 1, Math.max(-0.25, b.stretch))
    );
    let longScale = 1 + stretch;

    b.element.setAttribute(
      "transform",
      "translate(" + b.x + " " + b.y + ") " +
      "scale(" + shapeScale + " 1) " +
      "rotate(" + b.stretchAngle + ") " +
      "scale(" + longScale + " " + (1 / longScale) + ") " +
      "translate(" + (-b.x) + " " + (-b.y) + ")"
    );
  }

  if (typeof classificationActive !== "undefined" && classificationActive) {
    positionClassificationZones();
  }
}

//ball stretch
function animateBallDeformation(seconds) {
  let targets = [];

  for (let i = 0; i < gameBalls.length; i++) {
    targets.push(0);
  }

  if (ballDrag && !ballDrag.groupMode) {
    let selectedId = ballDrag.origins[0].id;

    for (let i = 0; i < gameLinks.length; i++) {
      let link = gameLinks[i];

      if (link.from !== selectedId && link.to !== selectedId) {
        continue;
      }

      let firstBall = getBallById(link.from);
      let secondBall = getBallById(link.to);
      let dx = secondBall.x - firstBall.x;
      let dy = secondBall.y - firstBall.y;
      let tension = Math.min(
        ballSettings.ballStretchMax,
        Math.max(0, Math.hypot(dx, dy) / link.restDistance - 1) * 0.5
      );
      let ends = [firstBall, secondBall];

      // 多条线同时拉一个球时，使用拉伸最强的一条。
      for (let j = 0; j < ends.length; j++) {
        let b = ends[j];
        let index = gameBalls.indexOf(b);

        if (tension > targets[index]) {
          targets[index] = tension;
          b.stretchAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        }
      }
    }
  }

  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];
    let remaining = seconds;

    // 小时间步 + 阻尼：经过圆形后轻微压扁，再逐渐稳定。
    while (remaining > 0) {
      let step = Math.min(remaining, 1 / 120);
      b.stretchVelocity +=
        ((targets[i] - b.stretch) * ballSettings.ballSpring -
          b.stretchVelocity * ballSettings.ballDamping) * step;
      b.stretch += b.stretchVelocity * step;
      remaining -= step;
    }
  }
}

//ball rebound
function startBallRebound(firstBall, secondBall) {
  let angle = Math.atan2(
    secondBall.y - firstBall.y,
    secondBall.x - firstBall.x
  ) * 180 / Math.PI;
  let ends = [firstBall, secondBall];

  for (let i = 0; i < ends.length; i++) {
    let b = ends[i];
    // 快速拉断时也保留可见伸长，再向圆形方向释放。
    b.stretch = Math.max(b.stretch, ballSettings.ballStretchMax * 0.8);
    b.stretchVelocity = -2.8;
    b.stretchAngle = angle;
  }
}

//connected group
function findConnectedBalls(startId) {
  let connectedIds = [startId];
  let group = [];

  // 名单中每加入一个球，就继续检查它与谁连接。
  for (let i = 0; i < connectedIds.length; i++) {
    for (let j = 0; j < gameLinks.length; j++) {
      let link = gameLinks[j];
      let neighbourId = null;

      if (link.from === connectedIds[i]) {
        neighbourId = link.to;
      } else if (link.to === connectedIds[i]) {
        neighbourId = link.from;
      }

      if (neighbourId !== null && !connectedIds.includes(neighbourId)) {
        connectedIds.push(neighbourId);
      }
    }
  }

  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];

    if (connectedIds.includes(b.id)) {
      group.push(b);
    }
  }

  return group;
}

//pointer position
function getBallPointerPosition(event) {
  let screenMatrix = ballPlayfield.getScreenCTM();

  if (!screenMatrix) {
    return null;
  }

  // 浏览器坐标转换为 SVG 坐标，每次重新获取，适应窗口大小变化。
  let pointer = new DOMPoint(event.clientX, event.clientY);
  return pointer.matrixTransform(screenMatrix.inverse());
}

//pointer down
function startBallDrag(event) {
  let circle = event.target.closest(".gameBall");

  if (!circle || !ballGameActive || ballDrag || event.button !== 0) {
    return;
  }

  // 完成提示期间等待换单，避免新的操作覆盖提示。
  if (typeof classificationActive !== "undefined" && classificationActive && isOrderComplete()) return;

  let pointer = getBallPointerPosition(event);

  if (!pointer) {
    return;
  }

  let selectedBall = getBallById(Number(circle.dataset.ballId));
  let connectedBalls = findConnectedBalls(selectedBall.id);

  // 新球组完整进入后才能抓取，避免边界夹紧把仍在画面外的球瞬移进来。
  if (typeof classificationActive !== "undefined" && classificationActive) {
    let bounds = getBallBounds(connectedBalls);
    let radius = ballSettings.radius + 2;
    if (bounds.minX < radius || bounds.maxX > ballPlayfield.viewBox.baseVal.width - radius) {
      showClassificationFeedback("Wait until the whole group has entered the work area.", "info");
      return;
    }
  }

  if (typeof classificationActive !== "undefined" && classificationActive &&
      selectedBall.state === "staging" && connectedBalls.length > 1 && !event.shiftKey) {
    showClassificationFeedback("Hold Shift and drag to retrieve the staged group.");
    return;
  }

  let pausedIds = [];
  let origins = [];

  //save group position
  for (let i = 0; i < connectedBalls.length; i++) {
    let b = connectedBalls[i];

    if (event.shiftKey) {
      pausedIds.push(b.id);
    }

    if (event.shiftKey || b.id === selectedBall.id) {
      origins.push({
        id: b.id,
        x: b.x,
        y: b.y,
        velocityX: 0,
        velocityY: 0,
      });
    }
  }

  // 保存点击位置，抓球边缘时不会突然跳到球心。
  ballDrag = {
    pointerId: event.pointerId,
    selectedId: selectedBall.id,
    groupMode: event.shiftKey,
    startPointer: pointer,
    pausedIds: pausedIds,
    origins: origins,
    tracking: null,
  };
  if (typeof classificationActive !== "undefined" && classificationActive) {
    ballDrag.tracking = startBehaviourAction();
  }
  shiftFollow = null;

  //Shift mode
  if (ballDrag.groupMode) {
    let maxLag = Math.max(0, ballSettings.shiftFollowMaxLag);

    for (let i = 0; i < gameLinks.length; i++) {
      let link = gameLinks[i];

      if (!pausedIds.includes(link.from)) {
        continue;
      }

      let firstBall = getBallById(link.from);
      let secondBall = getBallById(link.to);
      let distance = Math.hypot(firstBall.x - secondBall.x, firstBall.y - secondBall.y);

      // 连接已很长时缩小延迟，避免 Shift 造成意外断线。
      maxLag = Math.min(maxLag, Math.max(0, (ballSettings.breakDistance - distance - 1) / 2));
    }

    shiftFollow = {
      selectedId: selectedBall.id,
      origins: origins,
      maxLag: maxLag,
    };

    for (let i = 0; i < connectedBalls.length; i++) {
      let b = connectedBalls[i];
      b.stretch = 0;
      b.stretchVelocity = 0;
    }
  }

  event.preventDefault();
  ballPlayfield.setPointerCapture(event.pointerId);
  ballPlayfield.classList.add("dragging");
}

//pointer move
function moveBallDrag(event) {
  if (!ballDrag || event.pointerId !== ballDrag.pointerId) {
    return;
  }

  let pointer = getBallPointerPosition(event);

  if (!pointer) {
    return;
  }

  let radius = ballSettings.radius + 2;
  let view = ballPlayfield.viewBox.baseVal;
  let origins = ballDrag.origins;
  let bounds = getBallBounds(origins);

  // 用共同位移限制整组边界，不把各球分别挤到同一点。
  let shiftX = Math.max(
    radius - bounds.minX,
    Math.min(view.width - radius - bounds.maxX, pointer.x - ballDrag.startPointer.x)
  );
  let shiftY = Math.max(
    radius - bounds.minY,
    Math.min(view.height - radius - bounds.maxY, pointer.y - ballDrag.startPointer.y)
  );

  for (let i = 0; i < origins.length; i++) {
    let origin = origins[i];

    if (ballDrag.groupMode && origin.id !== ballDrag.selectedId) {
      continue;
    }

    let b = getBallById(origin.id);
    b.x = origin.x + shiftX;
    b.y = origin.y + shiftY;
  }

  if (ballDrag.groupMode) {
    animateShiftFollow(0);
  } else {
    breakStretchedLinks();
  }

  renderBallGame();
  event.preventDefault();
}

//Shift follow
function animateShiftFollow(seconds) {
  if (!shiftFollow) {
    return;
  }

  let anchor = getBallById(shiftFollow.selectedId);
  let anchorOrigin = getBallOrigin(shiftFollow.origins, anchor.id);
  let radius = ballSettings.radius + 2;
  let view = ballPlayfield.viewBox.baseVal;
  let settled = true;

  for (let i = 0; i < shiftFollow.origins.length; i++) {
    let origin = shiftFollow.origins[i];

    if (origin.id === anchor.id) {
      continue;
    }

    let b = getBallById(origin.id);
    let targetX = anchor.x + origin.x - anchorOrigin.x;
    let targetY = anchor.y + origin.y - anchorOrigin.y;
    let remaining = seconds;

    // 跟随目标位置，阻尼减小摆动；只影响位置，不改变球的形状。
    while (remaining > 0) {
      let step = Math.min(remaining, 1 / 120);
      origin.velocityX +=
        ((targetX - b.x) * ballSettings.shiftFollowSpring -
          origin.velocityX * ballSettings.shiftFollowDamping) * step;
      origin.velocityY +=
        ((targetY - b.y) * ballSettings.shiftFollowSpring -
          origin.velocityY * ballSettings.shiftFollowDamping) * step;
      b.x += origin.velocityX * step;
      b.y += origin.velocityY * step;
      remaining -= step;
    }

    //limit follow distance
    let lagX = b.x - targetX;
    let lagY = b.y - targetY;
    let lag = Math.hypot(lagX, lagY);

    if (lag > shiftFollow.maxLag) {
      b.x = targetX + lagX / lag * shiftFollow.maxLag;
      b.y = targetY + lagY / lag * shiftFollow.maxLag;
      origin.velocityX = 0;
      origin.velocityY = 0;
    }

    //follow bounds
    let boundedX = Math.max(radius, Math.min(view.width - radius, b.x));
    let boundedY = Math.max(radius, Math.min(view.height - radius, b.y));

    if (boundedX !== b.x) {
      origin.velocityX = 0;
    }

    if (boundedY !== b.y) {
      origin.velocityY = 0;
    }

    b.x = boundedX;
    b.y = boundedY;

    if (Math.hypot(b.x - targetX, b.y - targetY) > 0.03 ||
        Math.hypot(origin.velocityX, origin.velocityY) > 0.1) {
      settled = false;
    }
  }

  if (settled && (!ballDrag || !ballDrag.groupMode)) {
    shiftFollow = null;
  }
}

//break links
function breakStretchedLinks() {
  if (ballDrag && ballDrag.groupMode) {
    return;
  }

  let previousCount = gameLinks.length;
  let remainingLinks = [];
  let broken = [];

  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];
    let firstBall = getBallById(link.from);
    let secondBall = getBallById(link.to);
    let distance = Math.hypot(
      firstBall.x - secondBall.x,
      firstBall.y - secondBall.y
    );

    if (distance > ballSettings.breakDistance) {
      if (typeof classificationActive !== "undefined" && classificationActive && behaviourSession) {
        broken.push({ link: { from: link.from, to: link.to }, before: getBehaviourGroup(findConnectedBalls(link.from)) });
      }
      startBallRebound(firstBall, secondBall);
      link.element.remove();
    } else {
      remainingLinks.push(link);
    }
  }

  // 只更新连接名单，不删除球。
  gameLinks = remainingLinks;

  // 同一轮同时断开的线，共用断裂前快照；after 是本轮结束后的连通分量。
  for (let i = 0; i < broken.length; i++) {
    recordBehaviourLink(broken[i].link, broken[i].before);
  }

  if (gameLinks.length !== previousCount) {
    updateBallStatus();
  }
}

//pointer up
function endBallDrag(event) {
  if (!ballDrag || (event && event.pointerId !== ballDrag.pointerId)) {
    return;
  }

  let completedDrag = ballDrag;
  if (completedDrag.tracking && event && event.type === "pointerup") {
    completedDrag.tracking.endedMs = getBehaviourElapsed();
  }
  let pointerId = ballDrag.pointerId;
  let selectedId = ballDrag.selectedId;
  ballDrag = null;
  ballPlayfield.classList.remove("dragging");

  if (ballPlayfield.hasPointerCapture(pointerId)) {
    ballPlayfield.releasePointerCapture(pointerId);
  }

  // 普通与 Shift 拖拽共用松手投放；Reset、失焦和 pointercancel 不提交。
  if (event && event.type === "pointerup" &&
      typeof classificationActive !== "undefined" && classificationActive) {
    finishClassificationDrop(selectedId, completedDrag);
  } else if (typeof classificationActive !== "undefined" && classificationActive) {
    restoreStagedDrag(completedDrag);
  }
}

//ball movement
function moveBallGroups(seconds) {
  let movedIds = [];
  let radius = ballSettings.radius + 2;
  let width = ballPlayfield.viewBox.baseVal.width;

  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];

    if (b.state === "staging") {
      continue;
    }

    if (movedIds.includes(b.id)) {
      continue;
    }

    let group = findConnectedBalls(b.id);
    let groupPaused = false;

    for (let j = 0; j < group.length; j++) {
      let member = group[j];
      movedIds.push(member.id);

      if (ballDrag && ballDrag.groupMode && ballDrag.pausedIds.includes(member.id)) {
        groupPaused = true;
      }
    }

    if (groupPaused) {
      continue;
    }

    // 普通拖拽只固定被抓的球，其他球继续滑行。
    let movingBalls = [];

    for (let j = 0; j < group.length; j++) {
      let member = group[j];
      let held = false;

      if (ballDrag && getBallOrigin(ballDrag.origins, member.id)) {
        held = true;
      }

      if (!held) {
        movingBalls.push(member);
      }
    }

    if (movingBalls.length === 0) {
      continue;
    }

    let shiftX = ballSettings.moveSpeed * seconds;
    let bounds = getBallBounds(movingBalls);

    if (typeof classificationActive !== "undefined" && classificationActive) {
      // B2 经过右侧离场；仍连着被抓小球时保留原有边界保护。
      if (movingBalls.length !== group.length && bounds.maxX + shiftX > width - radius) {
        shiftX = Math.max(0, width - radius - bounds.maxX);
      }
    } else if (bounds.maxX + shiftX > width - radius) {
      if (movingBalls.length !== group.length) {
        // 仍连着鼠标抓住的球时先停在边缘，不瞬移回左侧。
        shiftX = Math.max(0, width - radius - bounds.maxX);
      } else {
        shiftX = radius - bounds.minX;
      }
    }

    for (let j = 0; j < movingBalls.length; j++) {
      let member = movingBalls[j];
      member.x += shiftX;
    }
  }
}

//animation loop
function animateBallGame(timestamp) {
  let seconds = 0;

  if (previousBallTime !== null) {
    // 按实际时间差移动，卡顿时限制单步长度。
    seconds = Math.min((timestamp - previousBallTime) / 1000, 0.05);
  }

  previousBallTime = timestamp;
  if (typeof classificationActive !== "undefined" && classificationActive) {
    recycleDepartedGroups();
    supplyBallGroups(seconds);
  }

  moveBallGroups(seconds);
  animateShiftFollow(seconds);

  // 鼠标不动时，持续滑行也可能把连接拉断。
  if (ballDrag && !ballDrag.groupMode) {
    breakStretchedLinks();
  }

  animateBallDeformation(seconds);
  renderBallGame();
  ballFrameId = requestAnimationFrame(animateBallGame);
}

//page control
function setBallGameActive(active) {
  ballGameActive = active;
  previousBallTime = null;
  updateBehaviourActivity(active && !document.hidden);

  if (!active || document.hidden) {
    cancelAnimationFrame(ballFrameId);
    ballFrameId = null;
    endBallDrag();
  } else if (ballFrameId === null) {
    ballFrameId = requestAnimationFrame(animateBallGame);
  }
}

//window focus
function pauseBallDrag() {
  endBallDrag();
  previousBallTime = null;
}

function updateBallVisibility() {
  setBallGameActive(ballGameActive);
}

//events
ballPlayfield.addEventListener("pointerdown", startBallDrag);
ballPlayfield.addEventListener("pointermove", moveBallDrag);
ballPlayfield.addEventListener("pointerup", endBallDrag);
ballPlayfield.addEventListener("pointercancel", endBallDrag);
ballPlayfield.addEventListener("lostpointercapture", endBallDrag);
document.querySelector("#resetBalls").addEventListener("click", resetBallGame);
window.addEventListener("blur", pauseBallDrag);
document.addEventListener("visibilitychange", updateBallVisibility);

resetBallGame();
