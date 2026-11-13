"use strict";

//classification rules
// 颜色来自球对象，连接来自 gameLinks；不使用重叠或鼠标位置推断。
function getClassificationType(group, links) {
  if (links === undefined) {
    links = gameLinks;
  }

  if (group.length < 1 || group.length > 2) {
    return null;
  }

  let ids = [];
  let white = 0;
  let black = 0;
  let internalLinks = 0;

  for (let i = 0; i < group.length; i++) {
    let b = group[i];

    if (ids.includes(b.id)) {
      return null;
    }

    ids.push(b.id);

    if (b.color === "W") {
      white++;
    } else if (b.color === "B") {
      black++;
    } else {
      return null;
    }
  }

  for (let i = 0; i < links.length; i++) {
    let link = links[i];
    let firstInside = ids.includes(link.from);
    let secondInside = ids.includes(link.to);

    // 有连接通向组外，说明提交的并非完整球组。
    if (firstInside !== secondInside) {
      return null;
    }

    if (firstInside && secondInside) {
      if (link.from === link.to) {
        return null;
      }

      internalLinks++;
    }
  }

  if (group.length === 1 && internalLinks === 0) {
    return group[0].color;
  }

  if (group.length === 2 && internalLinks === 1) {
    if (white === 2) {
      return "WW";
    } else if (black === 2) {
      return "BB";
    } else {
      return "BW";
    }
  }

  return null;
}


//order setting
let classificationSettings = {
  maxActiveBalls: 24,
  stagingCapacity: 2,
  spawnSpacing: 72,
  spawnGap: 20,
  dropInset: 0,
};

//random supply setting
let supplySettings = {
  seed: 20261103,
  spawnInterval: 2,
  lengthWeights: [1, 2, 3, 2],
  angles: [0, 45, 90, 135, -45, -90],
  angleJitter: 10,
  bendDegrees: 18,
  minY: 170,
  maxY: 460, // 球心的自动传送下界，给底部的提示文字留空。
  positionAttempts: 16,
  entryClearance: 110,
};

let supplyRandomState = 1;
let supplyElapsed = 0;
let supplyTypeIndex = 0;
let recycledBalls = [];

let orderNumber = 1;
let nextOrderTimer = null;

// Work C v1.1 的像素矩形，按 SVG 逻辑坐标交给原有映射。
let classificationAreas = {
  staging: { x: 772 * 1000 / 908, y: 14 * 800 / 489, width: 137 * 1000 / 908, height: 53 * 800 / 489 },
  outlets: { x: 0, y: 390 * 800 / 489, width: 1000, height: 99 * 800 / 489 },
};

let classificationActive = true;
let orderTypes = ["WW", "BB", "BW", "W", "B"];
let currentOrder = [];
let supplyQueue = [];
let classifiedBalls = [];
let generatedBallCount = 0;
let generatedColors = { W: 0, B: 0 };
let nextBallId = 0;
let lastZoneGeometry = "";

//seeded random：相同种子和操作时间线，得到相同的供球序列。
function nextSupplyRandom() {
  supplyRandomState = supplyRandomState * 16807 % 2147483647;
  return (supplyRandomState - 1) / 2147483646;
}

function resetClassification(newSession) {
  if (newSession === undefined) newSession = true;
  clearTimeout(nextOrderTimer);
  nextOrderTimer = null;
  for (let animation of document.querySelector("#company_page").getAnimations({ subtree: true })) {
    if (animation.id === "order-confirmation") animation.cancel();
  }
  if (newSession) orderNumber = 1;
  else orderNumber++;
  endBallDrag();
  shiftFollow = null;
  gameBalls = [];
  gameLinks = [];
  ballLinks.replaceChildren();
  ballCircles.replaceChildren();
  currentOrder = [];
  supplyQueue = [];
  classifiedBalls = [];
  recycledBalls = [];
  generatedBallCount = 0;
  generatedColors = { W: 0, B: 0 };
  previousBallTime = null;
  lastZoneGeometry = "";
  // 自动换单保留球 ID 和随机序列，避免同一 Session 内事件去重键冲突。
  if (newSession) {
    nextBallId = 0;
    supplyRandomState = Math.floor(Number(supplySettings.seed)) % 2147483647;
    if (!Number.isFinite(supplyRandomState) || supplyRandomState <= 0) {
      supplyRandomState = 1;
    }
  }
  supplyTypeIndex = Math.floor(nextSupplyRandom() * orderTypes.length);
  supplyElapsed = supplySettings.spawnInterval;

  for (let i = 0; i < orderTypes.length; i++) {
    let type = orderTypes[i];
    // 每类独立抽取 1、2 或 3，继续使用同一个 Seed 随机序列。
    let target = Math.floor(nextSupplyRandom() * 3) + 1;
    currentOrder.push({ type: type, target: target, done: 0 });
  }

  if (newSession) startBehaviourSession();
  cloudOrderUploads = [];
  behaviourStays = {};
  behaviourOrderRecorded = false;
  behaviourOrderStartedMs = getBehaviourElapsed();
  supplyBallGroups(0);
  renderBallGame();
  updateClassificationUI();
  showClassificationFeedback("Random groups enter from the left. Missed balls that exit on the right are recycled and do not count toward the order.", "info");
  if (!document.querySelector("#gameWireframe").hidden) setBallGameActive(true);
}

//one useful segment in every recipe
function createSupplyRecipe() {
  let type = null;
  for (let i = 0; i < currentOrder.length; i++) {
    let index = (supplyTypeIndex + i) % currentOrder.length;
    let order = currentOrder[index];
    if (order.done < order.target) {
      type = order.type;
      supplyTypeIndex = (index + 1) % currentOrder.length;
      break;
    }
  }
  if (type === null) {
    return null;
  }

  let minimum = type.length;
  let limit = Math.min(supplySettings.lengthWeights.length, classificationSettings.maxActiveBalls);
  let totalWeight = 0;
  for (let i = minimum; i <= limit; i++) {
    totalWeight += Math.max(0, supplySettings.lengthWeights[i - 1]);
  }
  let choice = nextSupplyRandom() * totalWeight;
  let length = minimum;
  for (let i = minimum; i <= limit; i++) {
    choice -= Math.max(0, supplySettings.lengthWeights[i - 1]);
    if (choice < 0) {
      length = i;
      break;
    }
  }

  let colors = [];
  for (let i = 0; i < length; i++) {
    if (nextSupplyRandom() < 0.5) {
      colors.push("W");
    } else {
      colors.push("B");
    }
  }
  let start = Math.floor(nextSupplyRandom() * (length - minimum + 1));
  let reverse = nextSupplyRandom() < 0.5;
  for (let i = 0; i < minimum; i++) {
    let index = i;
    if (reverse) {
      index = minimum - 1 - i;
    }
    colors[start + i] = type[index];
  }

  let offsets = [{ x: 0, y: 0 }];
  let angles = supplySettings.angles;
  let angle = angles[Math.floor(nextSupplyRandom() * angles.length)];
  angle += (nextSupplyRandom() * 2 - 1) * supplySettings.angleJitter;
  for (let i = 1; i < length; i++) {
    let radians = angle * Math.PI / 180;
    let previous = offsets[i - 1];
    offsets.push({
      x: previous.x + Math.cos(radians) * classificationSettings.spawnSpacing,
      y: previous.y + Math.sin(radians) * classificationSettings.spawnSpacing,
    });
    angle += (nextSupplyRandom() * 2 - 1) * supplySettings.bendDegrees;
  }

  let positions = [];
  let bounds = getBallBounds(offsets);
  let height = bounds.maxY - bounds.minY;
  for (let i = 0; i < supplySettings.positionAttempts; i++) {
    positions.push(supplySettings.minY + nextSupplyRandom() *
      Math.max(0, supplySettings.maxY - supplySettings.minY - height));
  }
  return { colors: colors, offsets: offsets, positions: positions, type: type };
}

//reserve the entrance path, including lines and nearby balls
function findSupplyPosition(recipe) {
  let bounds = getBallBounds(recipe.offsets);
  let radius = ballSettings.radius + 2;
  let gap = classificationSettings.spawnGap;
  for (let i = 0; i < recipe.positions.length; i++) {
    let x = -radius - bounds.maxX;
    let y = recipe.positions[i] - bounds.minY;
    let top = y + bounds.minY - radius - gap;
    let bottom = y + bounds.maxY + radius + gap;
    let free = true;
    let checked = [];
    for (let j = 0; j < gameBalls.length; j++) {
      let b = gameBalls[j];
      if (checked.includes(b.id)) {
        continue;
      }
      let group = findConnectedBalls(b.id);
      for (let k = 0; k < group.length; k++) {
        checked.push(group[k].id);
      }
      let occupied = getBallBounds(group);
      if (occupied.minX - radius < supplySettings.entryClearance &&
          occupied.maxY + radius > top && occupied.minY - radius < bottom) {
        free = false;
        break;
      }
    }
    if (free) {
      return { x: x, y: y, offsets: recipe.offsets };
    }
  }
  return null;
}

//append one group without rebuilding existing SVG elements
function spawnClassificationGroup(colors, position) {
  let previousId = null;

  for (let i = 0; i < colors.length; i++) {
    let b = {
      id: nextBallId,
      color: colors[i],
      x: position.x + i * classificationSettings.spawnSpacing,
      y: position.y,
      state: "work",
      stretch: 0,
      stretchVelocity: 0,
      stretchAngle: 0,
    };
    if (position.offsets) {
      b.x = position.x + position.offsets[i].x;
      b.y = position.y + position.offsets[i].y;
    }
    nextBallId++;
    b.element = document.createElementNS(ballSvgNamespace, "circle");
    b.element.setAttribute("r", ballSettings.radius);
    b.element.setAttribute("class", "gameBall");
    b.element.setAttribute("fill", b.color === "B" ? "#181a17" : "#fff");
    b.element.dataset.ballId = b.id;
    ballCircles.appendChild(b.element);
    gameBalls.push(b);
    generatedBallCount++;
    generatedColors[b.color]++;

    if (previousId !== null) {
      let previousBall = getBallById(previousId);
      let link = {
        from: previousId,
        to: b.id,
        restDistance: Math.hypot(b.x - previousBall.x, b.y - previousBall.y),
        element: document.createElementNS(ballSvgNamespace, "line"),
      };
      link.element.setAttribute("class", "ballLink");
      ballLinks.appendChild(link.element);
      gameLinks.push(link);
    }

    previousId = b.id;
  }
}

//paced supply：不补齐错过的帧，避免一次突然生成多组。
function supplyBallGroups(seconds) {
  if (!classificationActive) {
    return;
  }
  if (seconds === undefined) {
    seconds = 0;
  }
  if (isOrderComplete()) {
    supplyQueue = [];
    return;
  }
  supplyElapsed = Math.min(supplySettings.spawnInterval, supplyElapsed + seconds);
  if (supplyElapsed < supplySettings.spawnInterval || ballDrag) {
    return;
  }
  // 一次只保留下一份配方；等待空位时不反复抽随机数。
  if (supplyQueue.length === 0) {
    supplyQueue.push(createSupplyRecipe());
  }
  let recipe = supplyQueue[0];
  // 等待期间对应订单可能已完成，此时重新规划。
  for (let i = 0; i < currentOrder.length; i++) {
    let order = currentOrder[i];
    if (order.type === recipe.type && order.done >= order.target) {
      supplyQueue = [];
      return;
    }
  }
  if (gameBalls.length + recipe.colors.length > classificationSettings.maxActiveBalls) {
    return;
  }
  let position = findSupplyPosition(recipe);
  if (!position) {
    return;
  }
  spawnClassificationGroup(recipe.colors, position);
  supplyQueue.shift();
  supplyElapsed = 0;
  renderBallGame();
  updateClassificationUI();
}

//only recycle after the entire connected group has left the right edge
function recycleDepartedGroups() {
  let removedIds = [];
  let checked = [];
  let width = ballPlayfield.viewBox.baseVal.width;
  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];
    if (b.state === "staging" || checked.includes(b.id)) {
      continue;
    }
    let group = findConnectedBalls(b.id);
    let held = false;
    for (let j = 0; j < group.length; j++) {
      let member = group[j];
      checked.push(member.id);
      if ((ballDrag && ballDrag.pausedIds.includes(member.id)) ||
          (ballDrag && ballDrag.selectedId === member.id) ||
          (shiftFollow && getBallOrigin(shiftFollow.origins, member.id))) {
        held = true;
      }
    }
    let bounds = getBallBounds(group);
    if (held || bounds.minX - ballSettings.radius - 2 <= width) {
      continue;
    }
    let snapshot = getBehaviourGroup(group);
    recordBehaviourEvent("group_recycled", { group: snapshot, colors: snapshot.colors, groupSize: group.length }, "recycled:" + snapshot.groupId);
    for (let j = 0; j < group.length; j++) {
      let member = group[j];
      removedIds.push(member.id);
      recycledBalls.push({ id: member.id, color: member.color, state: "recycled" });
      member.element.remove();
    }
  }
  if (removedIds.length === 0) {
    return;
  }
  let balls = [];
  let links = [];
  for (let i = 0; i < gameBalls.length; i++) {
    if (!removedIds.includes(gameBalls[i].id)) {
      balls.push(gameBalls[i]);
    }
  }
  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];
    if (removedIds.includes(link.from) || removedIds.includes(link.to)) {
      link.element.remove();
    } else {
      links.push(link);
    }
  }
  gameBalls = balls;
  gameLinks = links;
  updateClassificationUI();
}

//map existing HTML zones onto the SVG coordinate space
function placeClassificationZone(element, area, matrix, container, layoutScale) {
  let point = new DOMPoint(area.x, area.y).matrixTransform(matrix);
  // 屏幕坐标已被画面整体缩放，写回内部 CSS 前先除回缩放比例。
  element.style.left = ((point.x - container.left) / layoutScale) + "px";
  element.style.top = ((point.y - container.top) / layoutScale) + "px";
  element.style.width = (area.width * matrix.a / layoutScale) + "px";
  element.style.height = (area.height * matrix.d / layoutScale) + "px";
  element.style.right = "auto";
  element.style.bottom = "auto";
}

function positionClassificationZones() {
  let field = ballPlayfield.getBoundingClientRect();

  if (field.width === 0 || field.height === 0) {
    return;
  }

  let matrix = ballPlayfield.getScreenCTM();
  let containerElement = document.querySelector("#gameWireframe");
  let container = containerElement.getBoundingClientRect();
  let layoutScale = container.width / parseFloat(getComputedStyle(containerElement).width);
  let geometry = [field.left, field.top, field.width, field.height, matrix.a, matrix.d, matrix.e, matrix.f].join(",");

  if (geometry === lastZoneGeometry) {
    return;
  }

  lastZoneGeometry = geometry;
  placeClassificationZone(document.querySelector(".stagingArea"), classificationAreas.staging, matrix, container, layoutScale);
  placeClassificationZone(document.querySelector(".sortingOutlets"), classificationAreas.outlets, matrix, container, layoutScale);
}

//visible circle bounds
function getBallScreenBounds(b) {
  let matrix = b.element.getScreenCTM();
  let center = new DOMPoint(b.x, b.y).matrixTransform(matrix);
  let radius = Number(b.element.getAttribute("r"));
  let style = getComputedStyle(b.element);
  let stroke = parseFloat(style.strokeWidth) / 2;
  let scaleX = Math.hypot(matrix.a, matrix.c);
  let scaleY = Math.hypot(matrix.b, matrix.d);
  let halfWidth = radius * scaleX;
  let halfHeight = radius * scaleY;

  // 旋转后的方形包围盒会虚增圆的范围；这里直接计算圆／椭圆的实际投影。
  if (style.stroke !== "none") {
    if (style.vectorEffect === "non-scaling-stroke") {
      let field = ballPlayfield.getBoundingClientRect();
      let layoutScale = field.width / parseFloat(getComputedStyle(ballPlayfield).width);
      halfWidth += stroke * layoutScale;
      halfHeight += stroke * layoutScale;
    } else {
      halfWidth += stroke * scaleX;
      halfHeight += stroke * scaleY;
    }
  }

  return {
    left: center.x - halfWidth,
    right: center.x + halfWidth,
    top: center.y - halfHeight,
    bottom: center.y + halfHeight,
  };
}

//whole visible ball bounds, not just the mouse or the center
function groupInsideRegion(group, region) {
  let area = region.getBoundingClientRect();

  if (group.length === 0 || area.width === 0 || area.height === 0) {
    return false;
  }

  let style = getComputedStyle(region);
  let scaleX = area.width / parseFloat(style.width);
  let scaleY = area.height / parseFloat(style.height);
  // 接收范围从实际边框内侧算起；额外内缩随整个画面等比缩放。
  let left = area.left + (parseFloat(style.borderLeftWidth) + classificationSettings.dropInset) * scaleX;
  let right = area.right - (parseFloat(style.borderRightWidth) + classificationSettings.dropInset) * scaleX;
  let top = area.top + (parseFloat(style.borderTopWidth) + classificationSettings.dropInset) * scaleY;
  let bottom = area.bottom - (parseFloat(style.borderBottomWidth) + classificationSettings.dropInset) * scaleY;

  for (let i = 0; i < group.length; i++) {
    let box = getBallScreenBounds(group[i]);

    if (box.left < left || box.right > right ||
        box.top < top || box.bottom > bottom) {
      return false;
    }
  }

  return true;
}

function groupTouchesRegion(group, region) {
  let area = region.getBoundingClientRect();

  for (let i = 0; i < group.length; i++) {
    let box = getBallScreenBounds(group[i]);

    if (box.right >= area.left && box.left <= area.right &&
        box.bottom >= area.top && box.top <= area.bottom) {
      return true;
    }
  }

  return false;
}

//called only after pointerup
function finishClassificationDrop(selectedId, completedDrag) {
  let accepted = resolveClassificationDrop(selectedId, completedDrag);
  let selectedBall = getBallById(selectedId);

  // 暂存球组投放失败时回到取出前的位置，避免框外的球仍被记为暂存。
  if (!accepted && selectedBall && selectedBall.state === "staging" && completedDrag) {
    restoreStagedDrag(completedDrag);
  }

  return accepted;
}

function restoreStagedDrag(completedDrag) {
  let selectedBall = getBallById(completedDrag.selectedId);

  if (!selectedBall || selectedBall.state !== "staging") {
    return;
  }

  shiftFollow = null;

  for (let i = 0; i < completedDrag.origins.length; i++) {
    let origin = completedDrag.origins[i];
    let b = getBallById(origin.id);
    b.x = origin.x;
    b.y = origin.y;
  }

  renderBallGame();
}

function resolveClassificationDrop(selectedId, completedDrag) {
  let selectedBall = getBallById(selectedId);

  if (!selectedBall) {
    return false;
  }

  positionClassificationZones();
  let group = findConnectedBalls(selectedId);
  let outlets = document.querySelectorAll("[data-outlet]");

  // 先找完整容纳球组的出口，避免相邻出口只碰到边缘就抢先接收。
  for (let i = 0; i < outlets.length; i++) {
    if (groupInsideRegion(group, outlets[i])) {
      return submitBallGroup(selectedId, outlets[i], completedDrag);
    }
  }

  for (let i = 0; i < outlets.length; i++) {
    if (groupTouchesRegion(group, outlets[i])) {
      return submitBallGroup(selectedId, outlets[i], completedDrag);
    }
  }

  let staging = document.querySelector("#stagingDrop");

  if (groupTouchesRegion(group, staging)) {
    return storeBallGroup(group, staging, completedDrag);
  }

  if (selectedBall.state === "staging") {
    if (groupInsideRegion(group, ballPlayfield)) {
      recordBehaviourRetrieved(group, "work", completedDrag);
      for (let i = 0; i < group.length; i++) {
        group[i].state = "work";
      }

      updateClassificationUI();
      showClassificationFeedback("Group returned to the work area.", "success");
      return true;
    }

    showClassificationFeedback("Return the whole group to the work area.", "error");
  }

  return false;
}

function submitBallGroup(selectedId, outlet, completedDrag) {
  let selectedBall = getBallById(selectedId);

  if (!selectedBall) {
    return false;
  }

  let group = findConnectedBalls(selectedId);
  let type = getClassificationType(group);
  let expected = outlet.dataset.outlet;

  if (type === null) {
    recordBehaviourAction("classification_error", group, { actualType: type, targetOutlet: expected, reason: "invalid_group" }, completedDrag);
    showClassificationFeedback("Split larger groups first. Outlets accept single balls or connected pairs.", "error");
    return false;
  }

  if (!groupInsideRegion(group, outlet)) {
    recordBehaviourAction("classification_error", group, { actualType: type, targetOutlet: expected, reason: "not_fully_inside" }, completedDrag);
    showClassificationFeedback("Place the whole group inside one outlet.", "error");
    return false;
  }

  if (type !== expected) {
    recordBehaviourAction("classification_error", group, { actualType: type, targetOutlet: expected, reason: "wrong_type" }, completedDrag);
    showClassificationFeedback("Wrong outlet. This is a " + type + " group. The outlet accepts " + expected + ".", "error");
    return false;
  }

  let order = null;

  for (let i = 0; i < currentOrder.length; i++) {
    if (currentOrder[i].type === type) {
      order = currentOrder[i];
    }
  }

  if (!order || order.done >= order.target) {
    recordBehaviourAction("classification_error", group, { actualType: type, targetOutlet: expected, reason: "order_full" }, completedDrag);
    showClassificationFeedback(type + " quota is full. This group did not count.", "error");
    return false;
  }

  // 先解除跟随引用，再移除球和线。计数只在全部验证通过后加一次。
  let classificationSnapshot = getBehaviourGroup(group);
  if (selectedBall.state === "staging") {
    recordBehaviourRetrieved(group, expected, completedDrag);
  }
  shiftFollow = null;
  let ids = [];

  for (let i = 0; i < group.length; i++) {
    let b = group[i];
    ids.push(b.id);
    b.element.remove();
    classifiedBalls.push({ id: b.id, color: b.color, state: "classified" });
  }

  let remainingBalls = [];
  let remainingLinks = [];

  for (let i = 0; i < gameBalls.length; i++) {
    if (!ids.includes(gameBalls[i].id)) {
      remainingBalls.push(gameBalls[i]);
    }
  }

  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];

    if (ids.includes(link.from) || ids.includes(link.to)) {
      link.element.remove();
    } else {
      remainingLinks.push(link);
    }
  }

  gameBalls = remainingBalls;
  gameLinks = remainingLinks;
  order.done++;
  recordBehaviourAction("classification_success", group, { type: type, group: classificationSnapshot }, completedDrag);
  supplyBallGroups();
  renderBallGame();
  updateClassificationUI();

  showOrderMotion(type);
  if (isOrderComplete()) {
    recordBehaviourOrder();
    setBallGameActive(false);
    showClassificationFeedback("Order Complete", "success");
    if (nextOrderTimer === null) {
      nextOrderTimer = setTimeout(startNextOrder, 1500);
    }
  } else {
    showClassificationFeedback(type + " submitted.", "success");
  }

  return true;
}

// 只重置本轮工作台；不清空日志，也不创建云端 Session。
function startNextOrder() {
  if (cloudDevPreview) resetClassification(false);
  else if (canRecordCloudWork()) settleCloudOrder(behaviourSession.sessionId, orderNumber);
}

//staging keeps IDs, colors and links
function storeBallGroup(group, staging, completedDrag) {
  let occupied = 0;
  let ids = [];

  for (let i = 0; i < group.length; i++) {
    ids.push(group[i].id);
  }

  for (let i = 0; i < gameBalls.length; i++) {
    if (gameBalls[i].state === "staging" && !ids.includes(gameBalls[i].id)) {
      occupied++;
    }
  }

  if (occupied + group.length > classificationSettings.stagingCapacity) {
    showClassificationFeedback("Staging area is full. Maximum capacity: " + classificationSettings.stagingCapacity + " balls.", "error");
    return false;
  }

  if (!groupInsideRegion(group, staging)) {
    showClassificationFeedback("Place the whole group inside the staging box.", "error");
    return false;
  }

  shiftFollow = null;

  for (let i = 0; i < group.length; i++) {
    group[i].state = "staging";
  }

  recordBehaviourStaged(group, completedDrag);

  updateClassificationUI();
  showClassificationFeedback("Group staged. Hold Shift and drag to retrieve it.", "success");
  return true;
}

function isOrderComplete() {
  for (let i = 0; i < currentOrder.length; i++) {
    if (currentOrder[i].done !== currentOrder[i].target) {
      return false;
    }
  }

  return true;
}

//conservation ledger
function getBallConservation() {
  let work = 0;
  let staging = 0;
  let ids = [];
  let colors = { W: 0, B: 0 };
  let valid = true;

  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];

    if (ids.includes(b.id)) {
      valid = false;
    }

    ids.push(b.id);
    colors[b.color]++;

    if (b.state === "work") {
      work++;
    } else if (b.state === "staging") {
      staging++;
    } else {
      valid = false;
    }
  }

  for (let i = 0; i < classifiedBalls.length; i++) {
    let b = classifiedBalls[i];

    if (ids.includes(b.id) || b.state !== "classified") {
      valid = false;
    }

    ids.push(b.id);
    colors[b.color]++;
  }

  for (let i = 0; i < recycledBalls.length; i++) {
    let b = recycledBalls[i];
    if (ids.includes(b.id) || b.state !== "recycled") {
      valid = false;
    }
    ids.push(b.id);
    colors[b.color]++;
  }

  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];
    let firstBall = getBallById(link.from);
    let secondBall = getBallById(link.to);

    if (!firstBall || !secondBall || firstBall.state !== secondBall.state) {
      valid = false;
    }
  }

  for (let i = 0; i < currentOrder.length; i++) {
    let order = currentOrder[i];

    if (order.done < 0 || order.done > order.target) {
      valid = false;
    }
  }

  if (generatedBallCount !== work + staging + classifiedBalls.length + recycledBalls.length ||
      colors.W !== generatedColors.W || colors.B !== generatedColors.B ||
      staging > classificationSettings.stagingCapacity) {
    valid = false;
  }

  return {
    valid: valid,
    generated: generatedBallCount,
    work: work,
    staging: staging,
    classified: classifiedBalls.length,
    recycled: recycledBalls.length,
  };
}

function updateClassificationUI() {
  let done = 0;
  let target = 0;

  for (let i = 0; i < currentOrder.length; i++) {
    let order = currentOrder[i];
    let label = document.querySelector('[data-order="' + order.type + '"]');
    label.textContent = order.done + " / " + order.target;
    label.classList.toggle("orderMet", order.done === order.target);
    done += order.done;
    target += order.target;
  }

  let progress = 100;

  if (target > 0) {
    progress = Math.round(done / target * 100);
  }

  document.querySelector("#orderCompletion").textContent =
    "Order " + orderNumber + " · " + done + " / " + target + " · " + progress + "%";
  document.querySelector("#orderCompletion").classList.toggle("orderMet", isOrderComplete());
  let numberLabel = String(orderNumber).padStart(2, "0");
  let totalLabel = String(done).padStart(2, "0") + " / " + String(target).padStart(2, "0");
  document.querySelector("#workOrderTitle .access-title-text").textContent = "Order " + numberLabel;
  document.querySelector("#workOrderNumber .access-slide-text").textContent = numberLabel;
  document.querySelector("#workOrderTotal .access-title-text").textContent = totalLabel;
  document.querySelector("#workOrderPlateTotal .access-slide-text").textContent = totalLabel;
  let count = getBallConservation();
  let waiting = 0;

  for (let i = 0; i < supplyQueue.length; i++) {
    waiting += supplyQueue[i].colors.length;
  }

  document.querySelector("#stagingCount").textContent = count.staging + " / " + classificationSettings.stagingCapacity;
  ballStatus.textContent =
    "Generated " + count.generated + " = Work area " + count.work +
    " + Staged " + count.staging + " + Sorted " + count.classified +
    " + Recycled " + count.recycled + " · Queued " + waiting + " · Seed " + supplySettings.seed;

  if (!count.valid) {
    ballStatus.textContent += " · Ball count check failed. Click Reset.";
  }
}

let classificationFeedbackAnimation;

//order feedback motion
function showOrderMotion(type) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let label = document.querySelector('[data-order="' + type + '"]');
  animateOrderFeedback(label, [
    { transform: "scale(1)", easing: "cubic-bezier(.18, .9, .3, 1)" },
    { transform: "scale(1.34)", offset: 0.24, easing: "ease-out" },
    { transform: "scale(1)" }
  ], { duration: 460 });

  if (isOrderComplete()) {
    animateOrderPanel(document.querySelector(".work-order-header"), 780);
    animateOrderPanel(document.querySelector(".work-order-plate"), 780);
  }
}

function animateOrderPanel(panel, duration) {
  animateOrderFeedback(panel, [
    { boxShadow: "inset 0 -7px var(--access-ink), inset 0 3px var(--access-accent)" },
    { boxShadow: "inset 0 -3px var(--access-ink), inset 0 2px var(--access-accent)", offset: 0.65 },
    { boxShadow: "inset 0 0 transparent" }
  ], { duration: duration, easing: "steps(3, end)" });
}

function animateOrderFeedback(element, keyframes, timing) {
  for (let animation of element.getAnimations()) {
    if (animation.id === "order-confirmation") animation.cancel();
  }
  let motion = element.animate(keyframes, timing);
  motion.id = "order-confirmation";
}

function showClassificationFeedback(message, result) {
  let feedback = document.querySelector("#orderFeedback");
  feedback.textContent = message;
  feedback.dataset.result = result || "info";

  if (classificationFeedbackAnimation) {
    classificationFeedbackAnimation.cancel();
    classificationFeedbackAnimation = null;
  }

  if ((result === "success" || result === "error") &&
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
    classificationFeedbackAnimation = feedback.animate(
      [{ color: "var(--access-ink)", offset: 0 }],
      { duration: 140, easing: "ease-out" }
    );
  }
}

resetBallGame();
