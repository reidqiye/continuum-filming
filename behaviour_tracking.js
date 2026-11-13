"use strict";

//tracking state：原始日志与按需计算的统计分开保存。
let behaviourSettings = { panelEventLimit: 100 };
let behaviourSession = null;
let behaviourEvents = [];
let behaviourEventKeys = new Set();
let behaviourNextEventId = 1;
let behaviourNextActionId = 1;
let behaviourStays = {};
let behaviourClockMs = 0;
let behaviourClockStarted = null;
let behaviourOrderRecorded = false;
let behaviourOrderStartedMs = 0;
let behaviourPanelTimer = null;
let behaviourPanel = document.querySelector("#behaviourPanel");

//one active-work clock, no per-frame sampling
function getBehaviourElapsed() {
  let elapsed = behaviourClockMs;
  if (behaviourClockStarted !== null) {
    elapsed += performance.now() - behaviourClockStarted;
  }
  return Math.max(0, Math.round(elapsed));
}

function updateBehaviourActivity(active) {
  if (behaviourClockStarted !== null) {
    behaviourClockMs += performance.now() - behaviourClockStarted;
    behaviourClockStarted = null;
  }
  if (active && behaviourSession) {
    behaviourClockStarted = performance.now();
  }
}

function copyBehaviourData(value) {
  return JSON.parse(JSON.stringify(value));
}

function getBehaviourGroup(group) {
  let snapshot = { groupId: "", ballIds: [], colors: "", size: group.length, balls: [], links: [] };
  for (let i = 0; i < group.length; i++) {
    let b = group[i];
    snapshot.ballIds.push(b.id);
    snapshot.colors += b.color;
    snapshot.balls.push({ id: b.id, color: b.color, x: b.x, y: b.y, state: b.state || "work" });
  }
  snapshot.ballIds.sort(function(a, b) { return a - b; });
  snapshot.groupId = "group-" + snapshot.ballIds.join("-");
  for (let i = 0; i < gameLinks.length; i++) {
    let link = gameLinks[i];
    if (snapshot.ballIds.includes(link.from) && snapshot.ballIds.includes(link.to)) {
      snapshot.links.push({ from: link.from, to: link.to });
    }
  }
  return snapshot;
}

function getBehaviourBaseline() {
  let groups = [];
  let ids = [];
  for (let i = 0; i < gameBalls.length; i++) {
    let b = gameBalls[i];
    if (!ids.includes(b.id)) {
      let group = getBehaviourGroup(findConnectedBalls(b.id));
      groups.push(group);
      for (let j = 0; j < group.ballIds.length; j++) ids.push(group.ballIds[j]);
    }
  }
  return { groups: groups, order: copyBehaviourData(currentOrder), conservation: getBallConservation() };
}

function startBehaviourSession() {
  behaviourClockMs = 0;
  behaviourClockStarted = null;
  behaviourEvents = [];
  behaviourEventKeys = new Set();
  behaviourStays = {};
  behaviourOrderRecorded = false;
  behaviourSession = {
    sessionId: "session-" + crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    timeBasis: "active_work_ms",
    seed: supplySettings.seed,
    settings: copyBehaviourData({ supply: supplySettings, classification: classificationSettings, balls: ballSettings }),
    logRevision: 0,
    logStartedAtMs: 0,
    baseline: getBehaviourBaseline(),
  };
  updateBehaviourActivity(ballGameActive && !document.hidden);
  startCloudSession(behaviourSession);
  refreshBehaviourPanel();
}

//内部拖拽上下文，不生成 pointerdown 日志。
function startBehaviourAction() {
  if (!behaviourSession) return null;
  let action = {
    actionId: behaviourNextActionId++,
    sessionId: behaviourSession.sessionId,
    startedMs: getBehaviourElapsed(),
    endedMs: null,
  };
  return action;
}

function getBehaviourActionDetails(action) {
  let details = { actionId: action.actionId, actionDurationMs: null };
  if (action.endedMs !== null) {
    details.actionDurationMs = Math.max(0, action.endedMs - action.startedMs);
  }
  return details;
}

//状态变化处调用；相同操作键只收一次，快照不保留球/DOM 的引用。
function recordBehaviourEvent(eventType, details, key, action) {
  if (!behaviourSession || (action && action.sessionId !== behaviourSession.sessionId)) return null;
  if (behaviourEventKeys.has(key)) return null;
  let event = {
    eventId: behaviourNextEventId++,
    sessionId: behaviourSession.sessionId,
    eventType: eventType,
    elapsedMs: getBehaviourElapsed(),
    details: copyBehaviourData(details),
  };
  behaviourEventKeys.add(key);
  event.details.orderNumber = orderNumber;
  event.details.orderTargets = {};
  for (let i = 0; i < currentOrder.length; i++) {
    event.details.orderTargets[currentOrder[i].type] = currentOrder[i].target;
  }
  behaviourEvents.push(event);
  cloudOrderUploads.push(uploadCloudEvent(event));
  return event;
}

function recordBehaviourAction(eventType, group, details, completedDrag) {
  if (!completedDrag || !completedDrag.tracking || completedDrag.tracking.endedMs === null) return null;
  let action = completedDrag.tracking;
  let data = getBehaviourActionDetails(action);
  data.group = getBehaviourGroup(group);
  data.ballIds = data.group.ballIds;
  data.groupSize = group.length;
  for (let name in details) data[name] = details[name];
  return recordBehaviourEvent(eventType, data, eventType + ":" + action.actionId, action);
}

function recordBehaviourLink(link, before) {
  if (!behaviourSession) return;
  let parts = [];
  let checked = [];
  for (let i = 0; i < before.ballIds.length; i++) {
    let id = before.ballIds[i];
    if (!checked.includes(id)) {
      let group = getBehaviourGroup(findConnectedBalls(id));
      parts.push(group);
      for (let j = 0; j < group.ballIds.length; j++) checked.push(group.ballIds[j]);
    }
  }
  let first = getBallById(link.from);
  let second = getBallById(link.to);
  let details = {
    endpoints: [{ id: first.id, color: first.color }, { id: second.id, color: second.color }],
    before: before,
    after: parts,
    actionId: null,
  };
  let action = null;
  if (ballDrag) {
    action = ballDrag.tracking;
    if (action) details.actionId = action.actionId;
  }
  recordBehaviourEvent("link_broken", details, "link:" + Math.min(link.from, link.to) + ":" + Math.max(link.from, link.to), action);
}

function recordBehaviourStaged(group, completedDrag) {
  let snapshot = getBehaviourGroup(group);
  if (behaviourStays[snapshot.groupId]) return;
  let event = recordBehaviourAction("group_staged", group, {}, completedDrag);
  if (event) {
    behaviourStays[snapshot.groupId] = { startedMs: event.elapsedMs, stayId: event.eventId };
  }
}

function recordBehaviourRetrieved(group, destination, completedDrag) {
  let snapshot = getBehaviourGroup(group);
  let stay = behaviourStays[snapshot.groupId];
  if (!stay) return;
  let event = recordBehaviourAction("group_retrieved", group, {
    destination: destination,
    stayId: stay.stayId,
    stagingDurationMs: Math.max(0, getBehaviourElapsed() - stay.startedMs),
  }, completedDrag);
  if (event) delete behaviourStays[snapshot.groupId];
}

function recordBehaviourOrder() {
  if (!behaviourSession || behaviourOrderRecorded || !isOrderComplete()) return;
  behaviourOrderRecorded = true;
  let elapsed = getBehaviourElapsed() - behaviourOrderStartedMs;
  let statistics = getBehaviourStatistics();
  statistics.orderCompletionMs = elapsed;
  recordBehaviourEvent("order_completed", {
    taskDurationMs: elapsed,
    orderNumber: orderNumber,
    statistics: statistics,
    order: copyBehaviourData(currentOrder),
    partialLog: behaviourSession.logRevision > 0,
  }, "order_completed:" + orderNumber);
}

//statistics are derived, never incremented alongside game counters
function getBehaviourStatistics(events) {
  if (events === undefined) events = behaviourEvents;
  let stats = {
    classificationSuccesses: 0,
    successByType: { WW: 0, BB: 0, BW: 0, W: 0, B: 0 },
    classificationErrors: 0,
    errorsByReason: {},
    linksBroken: 0,
    groupsStaged: 0,
    groupsRetrieved: 0,
    averageSuccessDurationMs: null,
    recycledGroups: 0,
    orderCompletionMs: null,
  };
  let totalDuration = 0;
  let timedSuccesses = 0;
  let seen = new Set();
  for (let i = 0; i < events.length; i++) {
    let event = events[i];
    let id = event.sessionId + ":" + event.eventId;
    if (seen.has(id)) continue;
    seen.add(id);
    let details = event.details;
    if (event.eventType === "classification_success") {
      stats.classificationSuccesses++;
      stats.successByType[details.type]++;
      if (Number.isFinite(details.actionDurationMs) && details.actionDurationMs >= 0) {
        totalDuration += details.actionDurationMs;
        timedSuccesses++;
      }
    } else if (event.eventType === "classification_error") {
      stats.classificationErrors++;
      if (stats.errorsByReason[details.reason] === undefined) stats.errorsByReason[details.reason] = 0;
      stats.errorsByReason[details.reason]++;
    } else if (event.eventType === "link_broken") {
      stats.linksBroken++;
    } else if (event.eventType === "group_staged") {
      stats.groupsStaged++;
    } else if (event.eventType === "group_retrieved") {
      stats.groupsRetrieved++;
    } else if (event.eventType === "group_recycled") {
      stats.recycledGroups++;
    } else if (event.eventType === "order_completed" && stats.orderCompletionMs === null) {
      stats.orderCompletionMs = details.taskDurationMs;
    }
  }
  if (timedSuccesses > 0) stats.averageSuccessDurationMs = Math.round(totalDuration / timedSuccesses);
  return stats;
}

//clear only the log window; keep staging timers and whole-task clock
function clearBehaviourLog() {
  if (!behaviourSession) return;
  endBallDrag();
  behaviourEvents = [];
  behaviourSession.logRevision++;
  behaviourSession.logStartedAtMs = getBehaviourElapsed();
  behaviourSession.baseline = getBehaviourBaseline();
  behaviourSession.staysAtLogStart = copyBehaviourData(behaviourStays);
  behaviourSession.orderCompletedBeforeLogStart = behaviourOrderRecorded;
  refreshBehaviourPanel();
}

function getBehaviourExport() {
  return copyBehaviourData({
    schemaVersion: 1,
    session: behaviourSession,
    exportedAt: new Date().toISOString(),
    elapsedMs: getBehaviourElapsed(),
    events: behaviourEvents,
    statistics: getBehaviourStatistics(),
  });
}

function exportBehaviourLog() {
  if (!behaviourSession) return;
  let data = JSON.stringify(getBehaviourExport(), null, 2);
  let url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  let link = document.createElement("a");
  link.href = url;
  link.download = "continuum-" + behaviourSession.sessionId + ".json";
  // 临时下载入口随开发弹窗创建，点击后移除。
  behaviourPanel.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

//developer UI refreshes only while open, outside the animation loop
function refreshBehaviourPanel() {
  if (!behaviourPanel || !behaviourPanel.open) return;
  let info = "尚未开始 session";
  if (behaviourSession) {
    info = behaviourSession.sessionId + " · 工作时间 " + getBehaviourElapsed() + " ms · 事件 " + behaviourEvents.length;
    if (behaviourSession.logRevision > 0) info += " · 已清空过日志，当前统计仅含保留的事件";
  }
  document.querySelector("#behaviourSessionInfo").textContent = info;
  document.querySelector("#behaviourStats").textContent = JSON.stringify(getBehaviourStatistics(), null, 2);
  let start = Math.max(0, behaviourEvents.length - behaviourSettings.panelEventLimit);
  let visible = [];
  for (let i = start; i < behaviourEvents.length; i++) visible.push(behaviourEvents[i]);
  document.querySelector("#behaviourEvents").textContent = JSON.stringify(visible, null, 2);
}

function openBehaviourPanel() {
  if (!behaviourPanel.open) behaviourPanel.showModal();
  refreshBehaviourPanel();
  if (behaviourPanelTimer === null) behaviourPanelTimer = setInterval(refreshBehaviourPanel, 250);
}

function closeBehaviourPanel() {
  behaviourPanel.close();
}

function stopBehaviourPanelRefresh() {
  clearInterval(behaviourPanelTimer);
  behaviourPanelTimer = null;
}

document.querySelector("#openBehaviourLog").addEventListener("click", openBehaviourPanel);
document.querySelector("#closeBehaviourLog").addEventListener("click", closeBehaviourPanel);
document.querySelector("#exportBehaviourLog").addEventListener("click", exportBehaviourLog);
document.querySelector("#clearBehaviourLog").addEventListener("click", clearBehaviourLog);
behaviourPanel.addEventListener("close", stopBehaviourPanelRefresh);
