"use strict";

//cloud setting：Auth 负责登录会话，下面只处理演示需要的请求。
let continuumClient = null;
let cloudIdentity = null;
let cloudDevPreview = false;
let cloudWorkEnabled = false;
let cloudSessionId = null;
let cloudSessionPromise = null;
let cloudAiArchive = null;
let ownProfileHistory = null;
let profileHistoryRequest = 0;
// 仅保存本轮已经发出的请求结果，不保存待传事件，也不重试。
let cloudOrderUploads = [];

function setCloudState(state, message) {
  document.querySelector("#cloudSyncStatus").textContent = state + " · " + message;
}

function handleCloudError(error) {
  setCloudState("Error", error.message || "请求失败，游戏继续；本次数据不会自动重传。");
}

function canRecordCloudWork() {
  return cloudIdentity && cloudIdentity.employee.status === "active" && cloudWorkEnabled && !cloudDevPreview;
}

//先从 Auth 确认用户，再查找这个 UUID 对应的员工。
async function verifyCloudEmployee() {
  let auth = await continuumClient.auth.getUser();
  if (auth.error) throw auth.error;
  let user = auth.data.user;
  let result = await continuumClient.from("employees").select("id,employee_code,status,display_name").eq("id", user.id).single();
  if (result.error) throw result.error;
  return { user: user, employee: result.data };
}

async function saveEmployeeName(name) {
  let result = await continuumClient.rpc("set_employee_display_name", { p_name: name });
  if (result.error) throw result.error;
  return result.data;
}

async function signInCloud(email, password) {
  cloudIdentity = null;
  cloudAiArchive = null;
  cloudWorkEnabled = false;
  renderEmployeeProfile(calculateEmployeeProfile([], 0));
  let result = await continuumClient.auth.signInWithPassword({ email: email, password: password });
  if (result.error) throw result.error;
  cloudIdentity = await verifyCloudEmployee();
  cloudDevPreview = false;
  setCloudState("Connected", "已登录：" + cloudIdentity.employee.employee_code);
  return cloudIdentity;
}

async function signUpCloud(email, password) {
  let result = await continuumClient.auth.signUp({ email: email, password: password });
  if (result.error) throw result.error;
  if (!result.data.session) {
    throw { code: "registration_no_session" };
  }
  try {
    let identity = await verifyCloudEmployee();
    if (identity.user.id !== result.data.session.user.id) throw new Error("Signup identity changed.");
    cloudIdentity = identity;
  } catch {
    await signOutCloud();
    throw { code: "registration_employee_missing" };
  }
  cloudAiArchive = null;
  cloudWorkEnabled = false;
  cloudDevPreview = false;
  renderEmployeeProfile(calculateEmployeeProfile([], 0));
  setCloudState("Connected", "已登录：" + cloudIdentity.employee.employee_code);
}

async function signOutCloud() {
  cloudIdentity = null;
  cloudAiArchive = null;
  cloudWorkEnabled = false;
  cloudSessionId = null;
  cloudSessionPromise = null;
  cloudDevPreview = false;
  renderEmployeeProfile(calculateEmployeeProfile([], 0));
  clearProfileView();
  let result = await continuumClient.auth.signOut({ scope: "local" });
  if (result.error) handleCloudError(result.error);
  else setCloudState("Not signed in", "已退出登录。");
}

function enterCloudPreview() {
  let wasPreview = cloudDevPreview;
  cloudDevPreview = true;
  cloudWorkEnabled = false;
  renderEmployeeProfile(calculateEmployeeProfile([], 0));
  document.querySelector("#currentEmployee").textContent = " · DEV Preview";
  document.querySelector("#currentEmployee").removeAttribute("title");
  setCloudState("DEV Preview", "本地演示，不上传数据。");
  if (!wasPreview) resetBallGame();
}

async function beginCloudWork() {
  if (cloudDevPreview) return true;
  let identity = cloudIdentity;
  let verified = await verifyCloudEmployee();
  // 员工验证期间若已退出登录或进入预览，不再打开 Work。
  if (cloudIdentity !== identity || cloudDevPreview) return false;
  cloudIdentity = verified;
  if (cloudIdentity.employee.status !== "active") throw new Error("只有 active 员工可以开始工作。");
  if (!cloudWorkEnabled) {
    cloudWorkEnabled = true;
    resetBallGame();
  }
  return true;
}

//Reset 时调用：Promise 只用于等待父 Session，不是补传队列。
function startCloudSession(session) {
  cloudSessionId = null;
  cloudSessionPromise = null;
  if (!canRecordCloudWork()) return;
  cloudSessionId = session.sessionId;
  cloudSessionPromise = saveCloudSession(session);
}

async function saveCloudSession(session) {
  try {
    let result = await continuumClient.from("work_sessions").insert({
      session_id: session.sessionId,
      employee_id: cloudIdentity.user.id,
      seed: session.seed,
      settings: session.settings,
    });
    if (result.error) throw result.error;
    setCloudState("Connected", "Session 创建成功。");
    loadEmployeeProfile();
    return true;
  } catch (error) {
    handleCloudError(error);
    return false;
  }
}

async function uploadCloudEvent(event) {
  if (!canRecordCloudWork() || event.sessionId !== cloudSessionId) return false;
  let employeeId = cloudIdentity.user.id;
  let sessionReady = cloudSessionPromise;
  let earlierUploads = cloudOrderUploads.slice();
  try {
    // Reset 后各次上传仍等待自己原来的 Session。
    if (!await sessionReady) throw new Error("Session 尚未保存，不能上传事件。");
    if (event.eventType === "order_completed") {
      let results = await Promise.all(earlierUploads);
      if (results.includes(false)) throw new Error("本轮有事件未确认保存，不能完成结算。请导出日志或 Reset。");
    }
    if (!canRecordCloudWork() || cloudIdentity.user.id !== employeeId) return false;
    let result = await continuumClient.from("behaviour_events").insert({
      session_id: event.sessionId,
      event_id: event.eventId,
      event_type: event.eventType,
      elapsed_ms: event.elapsedMs,
      details: event.details,
    });
    if (result.error) throw result.error;
    setCloudState("Uploaded", "本次事件上传成功。");
    loadEmployeeProfile();
    return true;
  } catch (error) {
    handleCloudError(error);
    return false;
  }
}

// 每张订单只在完成后调用一次。数据库决定是否辞退。
async function settleCloudOrder(sessionId, number) {
  let uploads = cloudOrderUploads.slice();
  if (!canRecordCloudWork()) return;
  document.querySelector("#resetBalls").disabled = true;
  try {
    let results = await Promise.all(uploads);
    if (behaviourSession.sessionId !== sessionId || orderNumber !== number || !canRecordCloudWork()) return;
    if (results.includes(false)) throw new Error("本轮上传失败，未结算；请导出日志或 Reset。");
    let result = await continuumClient.rpc("finish_employee_order", { p_session_id: sessionId, p_order_number: number });
    if (result.error) throw result.error;
    if (behaviourSession.sessionId !== sessionId || orderNumber !== number || !canRecordCloudWork()) return;
    if (result.data.status === "terminated") {
      cloudIdentity.employee.status = "terminated";
      cloudWorkEnabled = false;
      isFormerEmployee = true;
      await loadEmployeeProfile();
      if (!cloudIdentity || cloudDevPreview || behaviourSession.sessionId !== sessionId) return;
      showEmployeeCompletion();
      loadDigitalArchive();
    } else {
      resetClassification(false);
    }
  } catch (error) {
    if (cloudIdentity && behaviourSession.sessionId === sessionId && orderNumber === number && !cloudDevPreview) {
      handleCloudError(error);
      showClassificationFeedback("Error · Could not confirm order completion. Check the Behaviour Log. You can export it or click Reset.", "error");
    }
  } finally {
    document.querySelector("#resetBalls").disabled = false;
  }
}

function renderDigitalArchive() {
  renderRestrictedPortal();
  if (profileMode === "former") return;
  let employee = cloudDevPreview ? null : cloudIdentity?.employee;
  let terminated = employee?.status === "terminated";
  let archive = terminated && cloudAiArchive?.employeeId === employee.id ? cloudAiArchive : null;
  let text = archive?.text || "";

  let introduction = document.querySelector("#aiIntroduction");
  introduction.hidden = !text;
  writeProfileIntroduction(introduction, text);
  document.querySelector("#profileIntroSource").textContent = text ? "Generated from saved work records." : "";
  let status = document.querySelector("#aiArchiveStatus");
  status.hidden = !!text;
  status.textContent = employee ? "Available after employment ends." : "No saved self-introduction.";
  if (terminated) status.textContent = "Pending Generation";
  if (archive?.loading) status.textContent = "Loading self-introduction…";
  if (archive?.failed) status.textContent = "Generation failed. Please try again.";
  document.querySelector("#retryAiArchive").hidden = !archive?.failed;
}

async function loadDigitalArchive(retry = false) {
  if (cloudDevPreview || cloudIdentity?.employee.status !== "terminated") return;
  let employeeId = cloudIdentity.user.id;
  if (cloudAiArchive?.employeeId === employeeId && !(retry && cloudAiArchive.failed)) return;
  let archive = { employeeId, text: "", failed: false, loading: true };
  cloudAiArchive = archive;
  renderDigitalArchive();

  try {
    let result = await continuumClient.from("employee_ai_profiles")
      .select("introduction").eq("employee_id", employeeId).maybeSingle();
    if (result.error) throw result.error;
    if (cloudAiArchive !== archive || cloudDevPreview || cloudIdentity?.user.id !== employeeId) return;
    if (result.data) {
      archive.text = result.data.introduction;
    } else {
      let generated = await continuumClient.functions.invoke("test-gemini");
      if (generated.error || !generated.data?.createdAt || !generated.data.text) {
        throw new Error("No saved introduction returned.");
      }
      archive.text = generated.data.text;
    }
  } catch {
    archive.failed = true;
  } finally {
    archive.loading = false;
    if (cloudAiArchive === archive) renderDigitalArchive();
  }
}

async function initializeCloud() {
  continuumClient = window.supabase.createClient(supabaseSettings.projectUrl, supabaseSettings.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: supabaseSettings.authStorageKey },
  });
  try {
    cloudIdentity = await verifyCloudEmployee();
    if (cloudDevPreview) return;
    setCloudState("Connected", "登录身份已恢复。");
    await showEmployeeHome();
  } catch (error) {
    if (error.name === "AuthSessionMissingError") setCloudState("Not signed in", "请使用 Email / Password 登录。");
    else handleCloudError(error);
  }
}

//profile progress：只接收数据库查回的事件，不使用 behaviourEvents。
function calculateEmployeeProfile(events, workSessions) {
  let profile = {
    workSessions: workSessions,
    classification_success: 0,
    classification_error: 0,
    link_broken: 0,
    group_staged: 0,
    group_retrieved: 0,
    order_completed: 0,
  };
  for (let i = 0; i < events.length; i++) {
    let type = events[i].event_type;
    if (profile[type] !== undefined) profile[type]++;
  }
  let work = Math.min(profile.classification_success, 20) * 2 + Math.min(profile.order_completed, 2) * 10;
  let collected = 0;
  let types = ["link_broken", "group_staged", "group_retrieved", "classification_success"];
  for (let i = 0; i < types.length; i++) {
    if (profile[types[i]] > 0) collected += 10;
  }
  profile.progress = Math.min(100, work + collected);
  return profile;
}

function renderEmployeeProfile(profile, savedHistory = false) {
  let employee = null;
  if (cloudIdentity && !cloudDevPreview) employee = cloudIdentity.employee;
  ownProfileHistory = savedHistory ? profile : null;
  if (profileMode !== "former") renderOwnProfileFields();
  document.querySelector(".profile_progress").style.setProperty("--progress", profile.progress + "%");
  document.querySelector(".progress_track").setAttribute("aria-valuenow", profile.progress);
  document.querySelector(".progress_label .access-title-text").textContent = profile.progress + "%";
  renderOwnMemoryModule(savedHistory ? profile.order_completed : null);
  let card = document.querySelector("[data-own-profile]");
  let icon = "red";
  if (employee && employee.status === "active") icon = "green";
  card.querySelector(".status img").src = "assets/" + icon + ".svg";
  card.querySelector(".status img").alt = employee ? employee.status : "Preview";
  if (!employee) document.querySelector("#profileLoadStatus").textContent = "No saved employee profile loaded.";
}

async function loadEmployeeProfile() {
  if (!cloudIdentity || cloudDevPreview) return;
  let identity = cloudIdentity;
  let employeeId = identity.user.id;
  let request = ++profileHistoryRequest;
  let status = document.querySelector("#profileLoadStatus");
  if (profileMode !== "former") status.textContent = "Loading saved history…";
  try {
    let sessions = await continuumClient.from("work_sessions").select("session_id", { count: "exact", head: true }).eq("employee_id", employeeId);
    if (sessions.error) throw sessions.error;
    let events = [];
    let start = 0;
    while (true) {
      // 按外键关联当前员工；每次读 500 条，避免 API 默认上限截断历史统计。
      let result = await continuumClient.from("behaviour_events").select("event_type,work_sessions!inner(employee_id)").eq("work_sessions.employee_id", employeeId).order("session_id").order("event_id").range(start, start + 499);
      if (result.error) throw result.error;
      for (let i = 0; i < result.data.length; i++) events.push(result.data[i]);
      if (result.data.length < 500) break;
      start += 500;
    }
    if (identity !== cloudIdentity || request !== profileHistoryRequest || cloudDevPreview) return;
    renderEmployeeProfile(calculateEmployeeProfile(events, sessions.count), true);
    if (profileMode !== "former") status.textContent = "Statistics from saved events.";
  } catch (error) {
    if (identity === cloudIdentity && request === profileHistoryRequest && !cloudDevPreview && profileMode !== "former") {
      status.textContent = "Could not load saved history.";
    }
  }
}
