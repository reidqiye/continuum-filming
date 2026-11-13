"use strict";

let currentPage = "login";
let isFormerEmployee = false;
let completedEmployeeId = null;
let workSessionResult = null;
let formerArchiveRequest = 0;
let loginClockTimer = null;
let completionCountTween = null;
let terminationLogTimeline = null;
let terminationLogLines = [];

//termination text reveal
function updateTerminationLog(pageName) {
  if (terminationLogTimeline) {
    terminationLogTimeline.kill();
    terminationLogTimeline = null;
  }
  if (terminationLogLines.length === 0) {
    for (let line of document.querySelectorAll(".termination-log p")) {
      let text = line.textContent;
      let accessible = document.createElement("span");
      accessible.className = "screenReaderOnly";
      accessible.textContent = text;
      let visual = document.createElement("span");
      visual.setAttribute("aria-hidden", "true");
      visual.textContent = text;
      line.replaceChildren(accessible, visual);
      terminationLogLines.push({ element: visual, text: text });
    }
  }
  for (let line of terminationLogLines) line.element.textContent = line.text;
  if (pageName !== "fired" || !window.ScrambleTextPlugin ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // React Bits ScrambledText uses GSAP ScrambleTextPlugin for its intro.
  gsap.registerPlugin(ScrambleTextPlugin);
  terminationLogTimeline = gsap.timeline();
  for (let i = 0; i < terminationLogLines.length; i++) {
    let line = terminationLogLines[i];
    terminationLogTimeline.to(line.element, {
      duration: 0.9,
      ease: "none",
      scrambleText: { text: line.text, chars: ".:", speed: 0.5, revealDelay: 0.15 }
    }, i * 0.12);
  }
}

function updateCompletionCount(pageName) {
  let percent = document.querySelector(".completion-percent");
  let completePage = document.querySelector("#complete_page");
  let progress = pageName === "work-ended" ? workSessionResult.progress : 100;
  if (completionCountTween) {
    completionCountTween.kill();
    completionCountTween = null;
  }
  percent.textContent = progress + "%";
  delete completePage.dataset.completionMotion;

  if ((pageName !== "complete" && pageName !== "work-ended") || !window.gsap ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // 只改变显示文字，进度条保留实际结算值。
  let count = { value: 0 };
  percent.textContent = "0%";
  if (pageName === "complete") completePage.dataset.completionMotion = "counting";
  completionCountTween = window.gsap.to(count, {
    value: progress,
    duration: 2,
    ease: "power2.out",
    onUpdate: function() {
      percent.textContent = Math.floor(count.value) + "%";
    },
    onComplete: function() {
      percent.textContent = progress + "%";
      if (pageName === "complete") completePage.dataset.completionMotion = "revealing";
      completionCountTween = null;
    }
  });
}

function showEmployeeCompletion() {
  if (cloudDevPreview || cloudIdentity?.employee.status !== "terminated") return;
  completedEmployeeId = cloudIdentity.user.id;
  showPage("complete");
}

function canShowEmploymentResult() {
  return cloudDevPreview || (cloudIdentity?.employee.status === "terminated" && completedEmployeeId === cloudIdentity.user.id);
}

function showWorkSessionEnd(progress, profile) {
  workSessionResult = { progress: progress, profile: profile };
  showPage("work-ended");
}

function renderWorkSessionEnd(ended) {
  document.querySelector("#profileCompleteTitle").hidden = ended;
  document.querySelector(".completion-description").hidden = ended;
  document.querySelector("#workEndedDetails").hidden = !ended;
  document.querySelector("#continueToTermination").hidden = ended;
  document.querySelector("#workEndedActions").hidden = !ended;
  document.querySelector(".completion-progress .employment-indicator").textContent =
    ended ? workOrderLimit + " ORDERS COMPLETED." : "ALL REQUIREMENTS MET.";
  document.querySelector(".completion-confirmation .employment-panel-end").textContent =
    ended ? "SESSION CLOSED" : "PROCESS COMPLETE";
  document.querySelector("#completeRecordState").textContent = ended ? "IN PROGRESS" : "FINALIZED";
  let percent = document.querySelector(".completion-percent");
  let progress = ended ? workSessionResult.progress : 100;
  percent.textContent = progress + "%";
  percent.setAttribute("aria-valuenow", progress);
  let list = document.querySelector("#workRemainingList");
  list.replaceChildren();
  if (!ended) return;
  let profile = workSessionResult.profile;
  let requirements = [];
  if (!profile) {
    requirements.push("Could not load the remaining requirements. Check your archive for saved progress.");
  } else {
    let groups = 20 - profile.classification_success;
    let orders = 2 - profile.order_completed;
    if (groups > 0) requirements.push("Classify " + groups + " more " + (groups === 1 ? "group." : "groups."));
    if (orders > 0) requirements.push("Complete " + orders + " more " + (orders === 1 ? "order." : "orders."));
    if (!profile.link_broken) requirements.push("Break a link between two balls.");
    if (!profile.group_staged) requirements.push("Move a group into Staging.");
    if (!profile.group_retrieved) requirements.push("Retrieve a group from Staging.");
  }
  for (let requirement of requirements) {
    let item = document.createElement("li");
    item.textContent = requirement;
    list.appendChild(item);
  }
}

const pages = document.querySelectorAll(".page");
const previewSelect = document.querySelector("#preview-page");
const previewNote = document.querySelector("#preview-note");
const nextButton = document.querySelector("#preview-next");
const gameWireframe = document.querySelector("#gameWireframe");
const backToCompany = document.querySelector("#backToCompany");
const employeeNameDialog = document.querySelector("#employeeNameDialog");
const loginSystemTime = document.querySelector("#loginSystemTime");

function updateLoginClock() {
  loginSystemTime.textContent = new Date().toISOString().slice(11, 19);
}

function syncLoginClock() {
  if (currentPage !== "login" || document.hidden) {
    clearInterval(loginClockTimer);
    loginClockTimer = null;
  } else if (loginClockTimer === null) {
    updateLoginClock();
    loginClockTimer = setInterval(updateLoginClock, 1000);
  }
}

document.addEventListener("visibilitychange", syncLoginClock);

function canReturnToWork() {
  if (isFormerEmployee || currentPage === "restricted") return false;
  return cloudDevPreview || (cloudIdentity && cloudIdentity.employee.status === "active");
}

function canShowRestrictedPortal() {
  return cloudDevPreview || cloudIdentity?.employee.status === "terminated";
}

function renderRestrictedPortal() {
  let preview = currentPage === "restricted" && cloudDevPreview;
  let employee = null;
  if (currentPage === "restricted" && !cloudDevPreview && cloudIdentity?.employee.status === "terminated") {
    employee = cloudIdentity.employee;
  }
  let archive = employee && cloudAiArchive?.employeeId === employee.id ? cloudAiArchive : null;
  let status = employee || preview ? "PENDING GENERATION" : "—";
  if (archive?.loading) status = "LOADING…";
  else if (archive?.failed) status = "GENERATION FAILED";
  else if (archive?.text) status = "AVAILABLE";

  let name = document.querySelector("#portalEmployeeName");
  name.textContent = employee?.display_name || "—";
  name.title = name.textContent;
  let code = document.querySelector("#portalEmployeeId");
  code.textContent = employee?.employee_code || "—";
  code.title = code.textContent;
  document.querySelector("#portalEmploymentStatus").textContent = employee?.status || (preview ? "terminated" : "—");
  document.querySelector("#portalRecordMode").textContent = preview ? "DEV PREVIEW" : "ARCHIVE / PERSONAL RECORD";
  document.querySelector("#portalArchiveStatus").textContent = status;
}

// 修改 hidden 切换页面
function showPage(pageName) {
  if (pageName === "work" && workSessionResult) pageName = "work-ended";
  if (pageName === "work-ended" && !workSessionResult) return;
  if (pageName === "login") workSessionResult = null;
  if (pageName === "profile" && !profileMode) return;
  if (pageName === "restricted" && !canShowRestrictedPortal()) return;
  const employmentResult = pageName === "complete" || pageName === "fired";
  if (employmentResult && !canShowEmploymentResult()) return;
  if (pageName === "fired" && !cloudDevPreview && currentPage !== "complete") return;
  if (pageName !== "profile" && profileMode) clearProfileView();
  if (!employmentResult) completedEmployeeId = null;
  let receiptId = "—";
  if (employmentResult && !cloudDevPreview) receiptId = cloudIdentity.employee.employee_code;
  if (pageName === "work-ended" && cloudIdentity && !cloudDevPreview) receiptId = cloudIdentity.employee.employee_code;
  document.querySelector("#completeEmployeeId").textContent = receiptId;
  document.querySelector("#terminatedEmployeeId").textContent = receiptId;
  stopGhostExample();
  if (!cloudDevPreview && cloudIdentity?.employee.status === "terminated" &&
      (pageName === "work" || pageName === "database")) pageName = "restricted";
  if (pageName === "work" && !cloudDevPreview && (!cloudIdentity || cloudIdentity.employee.status !== "active" || !cloudWorkEnabled)) {
    pageName = "login";
    document.querySelector("#login_message").textContent = "Log in to start work.";
  }
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  let previousPage = currentPage;
  currentPage = pageName;

  // id采用不同命名
  const pageIds = {
    login: "login_page",
    work: "company_page",
    database: "database_page",
    restricted: "restricted_page",
    profile: "profile_page",
    complete: "complete_page",
    "work-ended": "complete_page",
    fired: "fired_page"
  };
  pages.forEach(page => {
    page.hidden = page.id !== pageIds[pageName];
  });
  if (pageName === "profile" && previousPage !== "profile") playProfileIntroduction();
  if (pageName === "work-ended" || previousPage === "work-ended") {
    renderWorkSessionEnd(pageName === "work-ended");
  }
  if (pageName !== previousPage &&
      (pageName === "complete" || previousPage === "complete" ||
       pageName === "work-ended" || previousPage === "work-ended")) {
    updateCompletionCount(pageName);
  }
  if (pageName !== previousPage && (pageName === "fired" || previousPage === "fired")) {
    updateTerminationLog(pageName);
  }
  syncLoginClock();

  gameWireframe.hidden = pageName !== "work";
  document.querySelector("#resetBalls").hidden = pageName !== "work";
  setBallGameActive(pageName === "work");
  if (["work", "database", "restricted"].includes(pageName)) loadEmployeeProfile();

  renderRestrictedPortal();
  backToCompany.hidden = pageName !== "database" || !canReturnToWork();
  if (pageName === "database") renderOwnMemoryModule();
  previewSelect.value = pageName === "profile" ? "archive" : pageName;
  nextButton.hidden = pageName !== "work";

  const notes = {
    login: "",
    work: "B2：完整球组进入对应出口后松手；暂存区最多 2 球。订单进度与员工模型进度独立。",
    database: "第一张卡片是本人档案，其他已填充卡片是前员工档案。",
    profile: "",
    restricted: "离职员工可查看自己的档案。",
    complete: "Profile 100% · 当前订单已完成。",
    "work-ended": "Work session ended.",
    fired: "Employment terminated · 员工历史记录保留，重新登录后仅有查看权限。"
  };

  let note = notes[pageName];
  if (cloudDevPreview) note = note ? "DEV Preview · 不上传数据 · " + note : "DEV Preview · 不上传数据";
  previewNote.textContent = note;
  document.title = "CONTINUUM — " + pageName;
  if (pageName !== "profile") loadFormerEmployeeCards();
  updateAssistantAdvice();
}

function canShowRestrictedArchiveEdit() {
  return currentPage === "profile" && profileMode === "own" &&
    !cloudDevPreview && cloudIdentity?.employee.status === "terminated";
}

function openDialog(dialogId) {
  document.querySelector(dialogId).showModal();
}

document.querySelector("#editRestrictedArchive").addEventListener("click", function() {
  if (canShowRestrictedArchiveEdit()) openDialog("#permission_dialog");
});

document.querySelector("#retryAiArchive").addEventListener("click", function() {
  if (canShowRestrictedArchiveEdit()) loadDigitalArchive(true);
});

document.querySelector("#backFromProfile").addEventListener("click", function() {
  if (currentPage !== "profile") return;
  if (profileMode === "own" && workSessionResult) showPage("work-ended");
  else if (canShowRestrictedArchiveEdit() || (cloudDevPreview && isFormerEmployee)) showPage("restricted");
  else if (canReturnToWork()) showPage("database");
  else showPage("login");
});

function openOwnEmployeeProfile(slot = 1) {
  if (currentPage !== "database" && currentPage !== "restricted" && currentPage !== "work-ended") return;
  if (!cloudDevPreview) {
    let expectedStatus = currentPage === "restricted" ? "terminated" : "active";
    if (cloudIdentity?.employee.status !== expectedStatus) return;
  }
  configureProfileView("own", slot);
  renderOwnProfileFields();
  renderDigitalArchive();
  showPage("profile");
  loadEmployeeProfile();
  loadDigitalArchive();
  document.querySelector("#profileTitle").focus();
}

document.querySelector("#viewMyArchive").addEventListener("click", function() {
  if (currentPage === "restricted" && canShowRestrictedPortal()) openOwnEmployeeProfile();
});

function createEmployeeCard(icon, slot, empty = false) {
  let card = document.createElement(empty ? "div" : "button");
  let number = String(slot).padStart(2, "0");
  card.className = "employee-card";
  card.innerHTML =
    '<span class="rack-head rack-only" aria-hidden="true">SLOT / ' + number +
    '<strong>' + number + '</strong><span class="rack-status-light"></span></span>';
  if (empty) {
    card.classList.add("rack-empty");
    card.setAttribute("aria-hidden", "true");
    card.insertAdjacentHTML("beforeend", '<span class="rack-empty-label rack-only">EMPTY SLOT</span>');
    return card;
  }
  card.type = "button";
  card.insertAdjacentHTML("beforeend",
    '<span class="avatar"><img src="assets/avatar.svg" alt=""></span>' +
    '<span class="rack-id-label rack-only">EMPLOYEE ID</span>' +
    '<span class="employee-id">—</span>' +
    '<span class="employee-name">—</span>' +
    '<span class="rack-employment rack-only">—</span>' +
    '<span class="expertise"><span>Expertise:</span><span>Tasks:</span><span>Last Used:</span></span>' +
    '<span class="status">Status <img src="assets/' + icon + '.svg" alt=""></span>' +
    '<span class="rack-orders rack-only">ORDERS COMPLETED<strong>—</strong></span>' +
    '<span class="rack-serial rack-only" aria-hidden="true"><span></span><b>—</b></span>' +
    '<span class="rack-open rack-only">OPEN<br>PROFILE' +
    '<img class="rack-arrow-dark" src="assets/database/profile-arrow.svg" alt="">' +
    '<img class="rack-arrow-light" src="assets/database/profile-arrow-light.svg" alt=""></span>');
  return card;
}

function memoryBarcodePattern(code) {
  let seed = 1;
  for (let i = 0; i < code.length; i++) {
    seed = (seed * 31 + code.charCodeAt(i)) % 2147483647;
  }
  let stops = [];
  for (let position = 0; position < 100;) {
    seed = ((seed || 1) * 16807) % 2147483647;
    let end = position + 1 + seed % 3;
    let next = end + 1 + Math.floor(seed / 3) % 3;
    stops.push(`currentColor ${position}% ${end}%`, `transparent ${end}% ${next}%`);
    position = next;
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function renderMemoryModuleIdentity(card, employee = {}, preview = false) {
  let code = employee.employee_code || "—";
  let name = employee.display_name || (preview ? "DEV Preview" : "—");
  let status = "—";
  if (employee.status === "active") status = "Active";
  if (employee.status === "terminated") status = "Terminated";
  card.dataset.employment = employee.status || "";
  card.querySelector(".employee-id").textContent = code;
  let label = card.querySelector(".employee-name");
  label.textContent = name;
  label.title = name;
  card.querySelector(".rack-employment").textContent = status;
  card.querySelector(".rack-serial > span").style.backgroundImage = code === "—" ? "" : memoryBarcodePattern(code);
  card.querySelector(".rack-serial b").textContent = code.match(/\d+$/)?.[0] ?? "—";
}

function renderOwnMemoryModule(ordersCompleted) {
  let employee = cloudDevPreview ? null : cloudIdentity?.employee;
  let card = document.querySelector("[data-own-profile]");
  renderMemoryModuleIdentity(card, employee || {}, cloudDevPreview);
  document.querySelector("#rackOwnCode").textContent = employee?.employee_code ? "/ " + employee.employee_code : "";
  document.querySelector("#rackRecordMode").textContent = cloudDevPreview ? "DEV PREVIEW" : "LIVE / EMPLOYEE RECORDS";
  if (ordersCompleted !== undefined) card.querySelector(".rack-orders strong").textContent = ordersCompleted ?? "—";
}

function buildEmployeeCards() {
  let card = createEmployeeCard("red", 1);
  card.dataset.ownProfile = "true";
  card.addEventListener("click", function() {
    openOwnEmployeeProfile();
  });
  document.querySelector("#rackMyProfile").addEventListener("click", function() {
    if (currentPage === "database" && canReturnToWork()) card.click();
  });
  let grid = document.querySelector("#employeeGrid");
  grid.appendChild(card);
  grid.addEventListener("wheel", scrollMemoryRack, { passive: false });
}

function scrollMemoryRack(event) {
  if (currentPage !== "database" || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  let grid = event.currentTarget;
  if (grid.scrollWidth <= grid.clientWidth) return;

  // 纵向滚轮改为横向滑动；触控板原生横向滚动照常处理。
  let distance = event.deltaY;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) distance *= 16;
  else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) distance *= grid.clientWidth;
  event.preventDefault();
  grid.scrollLeft += distance;
}

function canReadFormerEmployees() {
  return currentPage === "database" && !cloudDevPreview && cloudIdentity?.employee.status === "active";
}

function renderFormerEmployeeCards(profiles = []) {
  let grid = document.querySelector("#employeeGrid");
  while (grid.children.length > 1) grid.lastElementChild.remove();
  let previewRack = currentPage === "database" && cloudDevPreview;
  let slots = Math.max(5, profiles.length);
  if (previewRack) slots = 8;
  for (let index = 0; index < slots; index++) {
    let profile = profiles[index];
    let testCard = previewRack && index >= 5;
    let card;
    if (profile) {
      card = createEmployeeCard("red", index + 2);
      card.dataset.formerProfile = "true";
      renderMemoryModuleIdentity(card, profile);
      card.querySelector(".rack-orders strong").textContent = profile.orders_completed ?? "—";
      card.addEventListener("click", function() {
        if (!card.isConnected || !canReadFormerEmployees()) return;
        configureProfileView("former", index + 2);
        fillFormerArchive(profile);
        showPage("profile");
        document.querySelector("#profileTitle").focus();
      });
    } else if (cloudDevPreview && (index === 0 || testCard)) {
      card = createEmployeeCard("green", index + 2);
      let preview = testCard ? { display_name: "Scroll Test " + (index - 4) } : {};
      renderMemoryModuleIdentity(card, preview, true);
      card.addEventListener("click", function() { openOwnEmployeeProfile(index + 2); });
    } else {
      card = createEmployeeCard("red", index + 2, true);
    }
    grid.appendChild(card);
  }
  grid.scrollLeft = 0;
  document.querySelector("#rackScrollHint").hidden = currentPage !== "database" || slots <= 5;
}

async function loadFormerEmployeeCards() {
  let request = ++formerArchiveRequest;
  renderFormerEmployeeCards();
  let count = document.querySelector("#rackModuleCount .access-title-text");
  count.textContent = "—";
  let status = document.querySelector("#formerArchiveListStatus");
  status.hidden = !canReadFormerEmployees();
  if (status.hidden) return;
  status.textContent = "Loading former employee archives…";

  let identity = cloudIdentity;
  try {
    let { data, error } = await continuumClient.rpc("list_former_employee_archives");
    if (request !== formerArchiveRequest || identity !== cloudIdentity || !canReadFormerEmployees()) return;
    if (error) throw error;
    renderFormerEmployeeCards(data);
    count.textContent = String(data.length + 1).padStart(2, "0");
    status.textContent = "No former employee archives yet.";
    status.hidden = data.length > 0;
  } catch {
    if (request === formerArchiveRequest && identity === cloudIdentity && canReadFormerEmployees()) {
      status.textContent = "Could not load former employee archives.";
    }
  }
}

//real Auth login
async function submitEmployeeLogin(event) {
  event.preventDefault();
  let email = document.querySelector("#employee_id").value.trim();
  let password = document.querySelector("#access_code").value;
  let button = document.querySelector(".login_submit");
  button.disabled = true;
  document.querySelector("#login_message").textContent = "Signing in…";
  try {
    await signInCloud(email, password);
    document.querySelector("#login_message").textContent = "";
    await showEmployeeHome();
  } catch (error) {
    handleCloudError(error);
    document.querySelector("#login_message").textContent = "Login failed. Check your email, access code, and connection.";
    showPage("login");
  } finally {
    password = "";
    document.querySelector("#access_code").value = "";
    button.disabled = false;
  }
}

document.querySelector("#login_form").addEventListener("submit", submitEmployeeLogin);

async function openWorkPage() {
  try {
    if (await beginCloudWork()) showPage("work");
  } catch (error) {
    if (!cloudIdentity || cloudDevPreview) return;
    handleCloudError(error);
    if (cloudIdentity && cloudIdentity.employee.status !== "active") {
      showPage("restricted");
    } else {
      document.querySelector("#login_message").textContent = "Unable to start work. Please log in again.";
      showPage("login");
    }
  }
}

async function showEmployeeHome() {
  let employee = cloudIdentity.employee;
  isFormerEmployee = employee.status !== "active";
  let label = " · " + employee.employee_code;
  if (employee.display_name) label += " · " + employee.display_name;
  document.querySelector("#currentEmployee").textContent = label;
  document.querySelector("#currentEmployee").title = label;
  if (isFormerEmployee) {
    showPage("restricted");
    loadDigitalArchive();
  } else if (!employee.display_name) {
    // 入职弹窗保留登录页背景，保存名字后再开始工作。
    document.querySelector("#login_message").textContent = "";
    showPage("login");
    document.querySelector("#employeeNameForm").reset();
    document.querySelector("#employeeNameMessage").textContent = "";
    employeeNameDialog.showModal();
  } else {
    await openWorkPage();
  }
}

document.querySelector("#employeeNameForm").addEventListener("submit", async function(event) {
  event.preventDefault();
  if (!cloudIdentity || cloudDevPreview || cloudIdentity.employee.status !== "active") return;
  let name = document.querySelector("#employeeNameInput").value.trim();
  let message = document.querySelector("#employeeNameMessage");
  if (!name || name.length > 40 || /[\x00-\x1f\x7f-\x9f]/.test(name)) {
    message.textContent = "Enter a name between 1 and 40 characters.";
    return;
  }
  let button = event.currentTarget.querySelector('[type="submit"]');
  let identity = cloudIdentity;
  button.disabled = true;
  message.textContent = "Saving…";
  try {
    let savedName = await saveEmployeeName(name);
    if (cloudIdentity !== identity || cloudDevPreview) return;
    identity.employee.display_name = savedName;
    await showEmployeeHome();
  } catch (error) {
    message.textContent = "Could not save your name. " + error.message;
  } finally {
    button.disabled = false;
  }
});

employeeNameDialog.addEventListener("cancel", event => event.preventDefault());
document.querySelector("#employeeNameLogout").addEventListener("click", () => document.querySelector("#preview-logout").click());

//employee registration
let registrationForm = document.querySelector("#registrationForm");
let registrationMessage = document.querySelector("#registrationMessage");
let registrationSubmit = registrationForm.querySelector('[type="submit"]');
let closeCreateProfile = document.querySelector("#closeCreateProfile");

function openCreateProfile(preview) {
  registrationForm.reset();
  registrationMessage.textContent = "";
  registrationForm.hidden = preview;
  document.querySelector("#registrationPreview").hidden = !preview;
  openDialog("#createDialog");
}

function registrationErrorMessage(error) {
  if (error.code === "user_already_exists" || error.code === "email_exists" || error.message === "User already registered") {
    return "This email is already registered. Log in instead.";
  }
  if (error.code === "weak_password") return "Choose a stronger password.";
  if (error.code === "signup_disabled" || error.code === "email_provider_disabled") {
    return "Email registration is currently disabled.";
  }
  if (error.code === "registration_no_session") return "Automatic sign-in is unavailable. Check your email for a confirmation link.";
  if (error.code === "registration_employee_missing") return "Your account was created, but the employee profile could not be loaded. Contact the administrator.";
  if (error.code === "unexpected_failure" || error.status === 500) {
    return "Could not create your employee profile. Please contact the administrator.";
  }
  return "Could not register. Check your connection or try logging in if you already submitted this email.";
}

async function submitEmployeeRegistration(event) {
  event.preventDefault();
  if (registrationForm.hidden || registrationSubmit.disabled) return;
  let email = document.querySelector("#registrationEmail");
  let password = document.querySelector("#registrationPassword");
  let confirmation = document.querySelector("#registrationConfirm");
  email.value = email.value.trim();
  if (!email.validity.valid) {
    registrationMessage.textContent = "Enter a valid email address.";
    return;
  }
  if (password.value.length < password.minLength) {
    registrationMessage.textContent = "Use at least " + password.minLength + " characters.";
    return;
  }
  if (password.value !== confirmation.value) {
    registrationMessage.textContent = "Passwords do not match.";
    return;
  }

  registrationSubmit.disabled = true;
  closeCreateProfile.disabled = true;
  registrationMessage.textContent = "Creating profile…";
  try {
    await signUpCloud(email.value, password.value);
    await showEmployeeHome();
    if (employeeNameDialog.open) {
      document.querySelector("#employeeNameMessage").textContent = "Profile created. Choose your name to continue.";
    }
  } catch (error) {
    registrationMessage.textContent = registrationErrorMessage(error);
  } finally {
    password.value = "";
    confirmation.value = "";
    registrationSubmit.disabled = false;
    closeCreateProfile.disabled = false;
  }
}

document.querySelector("#createProfile").addEventListener("click", function() {
  openCreateProfile(false);
});
registrationForm.addEventListener("submit", submitEmployeeRegistration);
document.querySelector("#createDialog").addEventListener("cancel", function(event) {
  if (registrationSubmit.disabled) event.preventDefault();
});
document.querySelector("#createDialog").addEventListener("close", function() {
  registrationForm.reset();
});

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

document.querySelectorAll(".taskButton").forEach(button => {
  button.addEventListener("click", async function() {
    document.querySelectorAll(".taskButton").forEach(item => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });

    await openWorkPage();
    if (currentPage === "work") {
      previewNote.textContent = (cloudDevPreview ? "DEV Preview · 不上传 · " : "") + "阶段 " + button.dataset.stage + " · 当前共用 B2 订单。";
    }
  });
});

document.querySelector("#openDatabase").addEventListener("click", () => showPage("database"));
backToCompany.addEventListener("click", function() {
  if (currentPage === "database" && canReturnToWork()) showPage("work");
});

document.querySelector("#preview-logout").addEventListener("click", async function() {
  clearTimeout(nextOrderTimer);
  endAssistantAdviceSession();
  document.querySelector("#access_code").value = "";
  setBallGameActive(false);
  await signOutCloud();
  document.querySelector("#currentEmployee").textContent = "";
  document.querySelector("#currentEmployee").removeAttribute("title");
  showPage("login");
});

document.querySelector("#workLogout").addEventListener("click", function() {
  if (currentPage !== "work") return;
  if (cloudDevPreview) showPage("login");
  else document.querySelector("#preview-logout").click();
});

document.querySelector("#workEndedArchive").addEventListener("click", function() {
  if (currentPage === "work-ended") openOwnEmployeeProfile();
});

document.querySelector("#workEndedLogout").addEventListener("click", function() {
  if (currentPage !== "work-ended") return;
  if (cloudDevPreview) showPage("login");
  else document.querySelector("#preview-logout").click();
});

document.querySelector("#continueToTermination").addEventListener("click", function() {
  if (currentPage === "complete" && canShowEmploymentResult()) showPage("fired");
});

document.querySelector("#signOutFromTermination").addEventListener("click", function() {
  if (currentPage !== "fired" || !canShowEmploymentResult()) return;
  if (cloudDevPreview) showPage("login");
  else document.querySelector("#preview-logout").click();
});

document.querySelector("#portalLogout").addEventListener("click", function() {
  if (currentPage !== "restricted" || !canShowRestrictedPortal()) return;
  if (cloudDevPreview) showPage("login");
  else document.querySelector("#preview-logout").click();
});

// 不代表真实任务完成。
previewSelect.addEventListener("change", () => {
  const requested = previewSelect.value;
  enterCloudPreview();
  isFormerEmployee = requested === "restricted" || requested === "permission";

  if (requested === "create") {
    showPage("login");
    openCreateProfile(true);
  } else if (requested === "archive" || requested === "permission") {
    showPage(requested === "archive" ? "database" : "restricted");
    openOwnEmployeeProfile();
    if (requested === "permission") openDialog("#permission_dialog");
    previewNote.textContent = "DEV Preview · 档案为 Figma 占位，不读取其他员工真实记录。";
  } else {
    showPage(requested);
  }

  previewSelect.value = requested;
});

nextButton.addEventListener("click", function() {
  if (currentPage !== "work") return;
  enterCloudPreview();
  showPage("complete");
});

buildEmployeeCards();
showPage("login");

initializeCloud();
