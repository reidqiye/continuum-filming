"use strict";

//fixed stage setting：1440 / 900 = 16 / 10
let stageSettings = {
  width: 1440,
  height: 900,
};

let stageViewport = document.querySelector("#stageViewport");
let stageRoot = document.documentElement;

function fitStage() {
  let area = stageViewport.getBoundingClientRect();

  if (area.width === 0 || area.height === 0) {
    return;
  }

  // 宽、高都放得下才采用该比例，多出的空间自然留白。
  let scale = Math.min(
    area.width / stageSettings.width,
    area.height / stageSettings.height
  );

  stageRoot.style.setProperty("--stage-width", stageSettings.width + "px");
  stageRoot.style.setProperty("--stage-height", stageSettings.height + "px");
  stageRoot.style.setProperty("--stage-scale", scale);
  stageRoot.style.setProperty("--stage-center-x", (area.left + area.width / 2) + "px");
  stageRoot.style.setProperty("--stage-center-y", (area.top + area.height / 2) + "px");
}

// 开发导航换行也会改变可用高度，因此观察画面容器的大小。
let stageObserver = new ResizeObserver(fitStage);
stageObserver.observe(stageViewport);
window.addEventListener("resize", fitStage);
fitStage();
