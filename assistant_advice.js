"use strict";

let currentAdvice = null;
let adviceCheckMs = 5000;
let adviceTimer = null;
let pendingAdvice = null;
let lastAdviceKey = null;
let adviceCache = new Map();
let playedAdvice = new Set();
let advicePanel = document.querySelector("#assistantAdvice");
let advisorName = document.querySelector("#advisorName");
let advisorMessage = document.querySelector("#advisorMessage");
let showGhostExample = document.querySelector("#showGhostExample");

function canViewAdvice() {
  return currentPage === "work" && ballGameActive && !cloudDevPreview && cloudIdentity?.employee.status === "active";
}

function clearAssistantAdvice() {
  currentAdvice = null;
  advisorName.textContent = "";
  advisorMessage.textContent = "";
  showGhostExample.hidden = true;
  stopGhostExample();
}

function stopAssistantAdvice() {
  clearInterval(adviceTimer);
  adviceTimer = null;
  pendingAdvice = null;
  lastAdviceKey = null;
  clearAssistantAdvice();
}

function updateAssistantAdvice() {
  stopAssistantAdvice();
  advicePanel.hidden = !canViewAdvice();
  if (!advicePanel.hidden) adviceTimer = setInterval(checkContextAdvice, adviceCheckMs);
}

function endAssistantAdviceSession() {
  stopAssistantAdvice();
  adviceCache.clear();
  playedAdvice.clear();
}

function adviceGroupFits(group, destination) {
  let rect = destination.getBoundingClientRect();
  let style = getComputedStyle(destination);
  let inset = classificationSettings.dropInset;
  let width = rect.width - 2 * (parseFloat(style.borderLeftWidth) + inset) * rect.width / parseFloat(style.width);
  let height = rect.height - 2 * (parseFloat(style.borderTopWidth) + inset) * rect.height / parseFloat(style.height);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let ball of group) {
    let bounds = getBallScreenBounds(ball);
    left = Math.min(left, bounds.left);
    right = Math.max(right, bounds.right);
    top = Math.min(top, bounds.top);
    bottom = Math.max(bottom, bounds.bottom);
  }
  return right - left < width && bottom - top < height;
}

function readAdviceOptions() {
  let options = [];
  if (ballDrag || isOrderComplete()) return options;
  let checked = new Set();
  let stagedBalls = 0;
  for (let ball of gameBalls) {
    if (ball.state === "staging") stagedBalls++;
  }

  // 只读取真实连通组和订单缺额。坐标及球 ID 不发送给服务端。
  for (let ball of gameBalls) {
    if (checked.has(ball.id)) continue;
    let group = findConnectedBalls(ball.id);
    for (let member of group) checked.add(member.id);
    if (!groupInsideRegion(group, ballPlayfield)) continue;
    let type = getClassificationType(group);
    let order = currentOrder.find(item => item.type === type);
    if (!order) continue;
    let remaining = order.target - order.done;
    let action;
    if (ball.state === "staging") {
      if (remaining > 0) action = "retrieve";
    } else if (remaining > 0) {
      let outlet = document.querySelector('[data-outlet="' + type + '"]');
      if (adviceGroupFits(group, outlet)) action = type;
    } else if (stagedBalls + group.length <= classificationSettings.stagingCapacity &&
               adviceGroupFits(group, ghostStaging)) {
      action = "stage";
    }
    if (action && !options.some(option => option.action === action && option.type === type)) {
      options.push({ action, type, remaining });
    }
  }
  return options.sort((a, b) => (a.action + a.type).localeCompare(b.action + b.type));
}

function hasAdviceOption(options, option) {
  return options.some(item => item.action === option.action && item.type === option.type &&
    item.remaining === option.remaining);
}

function playAdviceOption(option) {
  if (option.action === "stage" || option.action === "retrieve") playGhostExample(option.action, option.type);
  else playGhostExample("classify", option.type);
}

function showContextAdvice(data, options) {
  let option = data?.suggestion;
  if (!option || !hasAdviceOption(options, option)) return;
  // 同一种动作和缺额只自动演示一次，即使其他球组进出工作台。
  let key = JSON.stringify([data.advisorName, option.action, option.type, option.remaining]);
  if (currentAdvice?.key === key) return;
  stopGhostExample();
  currentAdvice = { key, option, availableGhostActions: [option.action] };
  advisorName.textContent = data.advisorName;
  advisorMessage.textContent = data.advice;
  showGhostExample.hidden = false;
  if (!playedAdvice.has(key)) {
    playedAdvice.add(key);
    playAdviceOption(option);
  }
}

async function checkContextAdvice() {
  if (adviceTimer === null || !canViewAdvice() || ballDrag) return;
  let options = readAdviceOptions();
  if (currentAdvice && !hasAdviceOption(options, currentAdvice.option)) clearAssistantAdvice();
  if (pendingAdvice) return;
  let key = JSON.stringify(options);
  if (key === lastAdviceKey) return;
  lastAdviceKey = key;
  if (options.length === 0) return;
  if (adviceCache.has(key)) {
    showContextAdvice(adviceCache.get(key), options);
    return;
  }

  let request = {};
  pendingAdvice = request;
  try {
    let { data, error } = await continuumClient.functions.invoke("former-employee-advice", {
      body: { mode: "context", options },
    });
    // Reset、离开 Work 或退出登录后，忽略旧页面的回复。
    if (pendingAdvice !== request || !canViewAdvice() || error) return;
    adviceCache.set(key, data);
    if (ballDrag) {
      lastAdviceKey = null;
      return;
    }
    showContextAdvice(data, readAdviceOptions());
  } catch {
    // 网络失败时保持安静，等候下一次有变化的情境。
  } finally {
    if (pendingAdvice === request) pendingAdvice = null;
  }
}

showGhostExample.addEventListener("click", function() {
  if (!canViewAdvice() || !currentAdvice) return;
  if (!hasAdviceOption(readAdviceOptions(), currentAdvice.option)) {
    clearAssistantAdvice();
    return;
  }
  playAdviceOption(currentAdvice.option);
});
// 此监听器在工作台重置之后运行，重新检查当前是否仍在 Work。
document.querySelector("#resetBalls").addEventListener("click", updateAssistantAdvice);
