"use strict";

let profileMode = "";
let profileTapeDotCount = 192;
let profileTapeColumns = 64;
let profileIntroductionTimeline = null;

//profile heading
function configureProfileView(mode, slot) {
  profileMode = mode;
  let restricted = mode === "own" && currentPage === "restricted";
  let slotNumber = String(slot).padStart(2, "0");
  document.querySelector("#profileSlotNumber").textContent = slotNumber;
  document.querySelector("#profileSlotReference").textContent = slotNumber;
  document.querySelector("#profileRecordMode").textContent = cloudDevPreview ? "DEV PREVIEW" : "LIVE / EMPLOYEE RECORDS";
  document.querySelector("#profileReadOnly").hidden = !restricted;
  document.querySelector("#editRestrictedArchive").hidden = !restricted || cloudDevPreview;
  document.querySelector("#backFromProfile span").textContent = restricted ? "BACK TO PORTAL" : "BACK TO DATABASE";
  document.querySelector(".profile-database-arrow").hidden = restricted;
  document.querySelector(".profile-portal-arrow").hidden = !restricted;
  document.querySelector("#profileProgressNote").hidden = mode !== "own" || cloudDevPreview;
  document.querySelector("#profileArchiveNote").hidden = mode !== "former";
  let accessMode = "OWN EMPLOYEE RECORD";
  if (mode === "former") accessMode = "ACTIVE EMPLOYEE VIEW · FORMER EMPLOYEE ARCHIVE · READ ONLY";
  if (cloudDevPreview) accessMode = "DEV PREVIEW";
  document.querySelector("#profileAccessMode").textContent = accessMode;
  document.querySelector(".profile-reading-body").scrollTop = 0;
}

function renderProfileIdentity(employee) {
  let name = employee?.display_name || "—";
  let code = employee?.employee_code || "—";
  let status = employee?.status || "—";
  document.querySelector("#profileEmployeeName").textContent = name;
  document.querySelector("#profileEmployeeName").title = name;
  document.querySelector("#profileEmployeeId").textContent = code;
  document.querySelector("#profileEmployeeId").title = code;
  document.querySelector("#profileEmployeeStatus").textContent = status;
  document.querySelector("#profileStatusLight").dataset.employment = status;
  document.querySelector("#profileSerial").textContent = code.match(/\d+$/)?.[0] ?? "—";
}

function renderOwnProfileFields() {
  let employee = cloudDevPreview ? null : cloudIdentity?.employee;
  let history = employee ? ownProfileHistory : null;
  renderProfileIdentity(employee);
  for (let field of document.querySelectorAll("#profile_page [data-profile]")) {
    let name = field.dataset.profile;
    let value = history?.[name];
    field.textContent = value ?? "—";
    if (name === "progress" && value != null) field.textContent += "%";
  }
  if (profileMode === "own") renderProfileTape(history?.classification_success, history?.classification_error);
}

function fillFormerArchive(profile) {
  renderProfileIdentity(profile);
  for (let field of document.querySelectorAll("#profile_page dd[data-former-field]")) {
    field.textContent = profile[field.dataset.formerField] ?? "—";
  }
  renderProfileTape(profile.classification_successes, profile.classification_errors);
  let text = profile.introduction || "";
  let intro = document.querySelector("#formerIntroduction");
  writeProfileIntroduction(intro, text);
  intro.hidden = !text;
  document.querySelector("#aiIntroduction").replaceChildren();
  document.querySelector("#aiIntroduction").hidden = true;
  document.querySelector("#retryAiArchive").hidden = true;
  document.querySelector("#profileIntroSource").textContent = text ? "Generated from saved work records." : "";
  let status = document.querySelector("#aiArchiveStatus");
  status.textContent = "No saved self-introduction.";
  status.hidden = !!text;
  document.querySelector("#profileLoadStatus").textContent = "WORK HISTORY · SAVED EVENT STATISTICS";
}

function clearProfileView() {
  stopProfileIntroduction();
  profileMode = "";
  document.querySelector("#formerIntroduction").textContent = "—";
  document.querySelector("#formerIntroduction").hidden = true;
  document.querySelector("#profileSlotNumber").textContent = "—";
  document.querySelector("#profileSlotReference").textContent = "—";
  document.querySelector("#editRestrictedArchive").hidden = true;
  document.querySelector("#profileReadOnly").hidden = true;
  renderProfileTape();
  renderOwnProfileFields();
  renderDigitalArchive();
}

//classification punch tape
function profileRecordCount(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  let count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return count;
}

function renderProfileTape(successValue, errorValue) {
  let successes = profileRecordCount(successValue);
  let errors = profileRecordCount(errorValue);
  let tape = document.querySelector("#profilePunchTape");
  let rate = document.querySelector("#profileSuccessRate");
  let ring = document.querySelector("#profileRateRing");
  let total = successes + errors;
  let hasRate = successes !== null && errors !== null && total > 0;
  let share = hasRate ? successes / total : 0;
  let successMarks = Math.round(profileTapeDotCount * share);
  // 固定点数按比例着色；有成功也有失败时，两种颜色各至少留一点。
  if (hasRate && successes > 0 && errors > 0) {
    successMarks = Math.max(1, Math.min(profileTapeDotCount - 1, successMarks));
  }

  let dots = document.createDocumentFragment();
  for (let i = 0; i < profileTapeDotCount; i++) {
    let dot = document.createElement(hasRate ? "img" : "span");
    if (hasRate) {
      dot.src = i < successMarks ? "assets/profile/success-dot.svg" : "assets/profile/error-dot.svg";
      dot.alt = "";
      let column = i % profileTapeColumns;
      let row = Math.floor(i / profileTapeColumns);
      dot.style.setProperty("--tape-dot-start", column * 10.5 + row * 55);
    } else {
      dot.className = "profile-tape-empty-dot";
    }
    dots.appendChild(dot);
  }
  tape.replaceChildren(dots);

  ring.removeAttribute("data-has-rate");
  ring.style.removeProperty("--profile-rate");
  ring.setAttribute("aria-label", "Classification success rate unavailable");
  rate.classList.remove("profile-rate-precise");
  rate.textContent = "—";
  if (!hasRate) return;

  ring.setAttribute("data-has-rate", "");
  ring.style.setProperty("--profile-rate", share * 100 + "%");
  let percent = Math.round(share * 10000) / 100;
  if (percent === 100 && errors > 0) rate.textContent = ">99.99%";
  else if (percent === 0 && successes > 0) rate.textContent = "<0.01%";
  else rate.textContent = percent + "%";
  ring.setAttribute("aria-label", "Classification success rate " + rate.textContent);
  rate.classList.toggle("profile-rate-precise", rate.textContent.length > 4);
}

function writeProfileIntroduction(element, text) {
  if (element.textContent === text) return;
  element.textContent = text;
  if (currentPage === "profile") playProfileIntroduction();
}

function stopProfileIntroduction() {
  if (profileIntroductionTimeline) profileIntroductionTimeline.kill();
  profileIntroductionTimeline = null;
  let overlay = document.querySelector("#profileIntroductionMotion");
  overlay.hidden = true;
  overlay.parentElement.classList.remove("is-scrambling");
  overlay.textContent = "";
}

function playProfileIntroduction() {
  stopProfileIntroduction();
  let intro = document.querySelector(profileMode === "former" ? "#formerIntroduction" : "#aiIntroduction");
  if (intro.hidden || !intro.textContent || !window.gsap || !window.ScrambleTextPlugin ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let overlay = document.querySelector("#profileIntroductionMotion");
  let lines = intro.textContent.split("\n");
  let previews = [];
  gsap.registerPlugin(ScrambleTextPlugin);
  profileIntroductionTimeline = gsap.timeline({
    paused: true,
    onUpdate: function() {
      let renderedLines = [];
      for (let preview of previews) renderedLines.push(preview.textContent);
      overlay.textContent = renderedLines.join("\n");
    },
    onComplete: stopProfileIntroduction
  });

  for (let line of lines) {
    // Text nodes keep archive content as text throughout the animation.
    let preview = document.createTextNode(line);
    previews.push(preview);
    if (!line.trim()) continue;
    profileIntroductionTimeline.to(preview, {
      duration: 0.8,
      ease: "none",
      scrambleText: { text: line, chars: ".:", speed: 0.5, revealDelay: 0.15 }
    }, 0);
  }
  if (!profileIntroductionTimeline.duration()) {
    stopProfileIntroduction();
    return;
  }
  overlay.hidden = false;
  overlay.parentElement.classList.add("is-scrambling");
  profileIntroductionTimeline.play(0.01);
}
