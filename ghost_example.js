"use strict";

let ghostTimeline = null;
let ghostLayer = document.querySelector("#ghostDemo");
let ghostPair = document.querySelector("#ghostPair");
let ghostLink = ghostPair.querySelector("line");
let ghostBalls = ghostPair.querySelectorAll("circle");
let ghostCursor = document.querySelector("#ghostCursor");
let ghostGrip = document.querySelector("#ghostGrip");
let ghostExampleLabel = document.querySelector("#ghostExampleLabel");
let ghostStaging = document.querySelector("#stagingDrop");

// GSAP gsap-timeline skill
// kill the timeline and its child tweens on exit
function stopGhostExample() {
  if (ghostTimeline) ghostTimeline.kill();
  ghostTimeline = null;
  ghostLayer.setAttribute("hidden", "");
  ghostExampleLabel.hidden = true;
}

function ghostBoxCenter(box, svgFromScreen) {
  let rect = box.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).matrixTransform(svgFromScreen);
}

function playGhostExample(action, type) {
  stopGhostExample();
  if (!canViewAdvice() || !ballGameActive || !window.gsap) return;
  if (action === "classify" && !/^(WW|BB|BW|W|B)$/.test(type)) return;
  if (action !== "classify" && action !== "stage" && action !== "retrieve") return;
  let actionId = action === "classify" ? type : action;
  if (!currentAdvice?.availableGhostActions.includes(actionId)) return;

  // read target once & use the playfield's SVG coordinates
  let screen = ballPlayfield.getScreenCTM();
  if (!screen) return;
  let svgFromScreen = screen.inverse();
  let workPoint = { x: 370, y: 335 };
  let start = workPoint;
  let target;
  if (action === "classify") {
    let outlet = document.querySelector('[data-outlet="' + type + '"]');
    target = ghostBoxCenter(outlet, svgFromScreen);
  } else {
    // 情境演示用当前球组的类型，旧演示保留通用 BW。
    if (!/^(WW|BB|BW|W|B)$/.test(type)) type = "BW";
    let stagingPoint = ghostBoxCenter(ghostStaging, svgFromScreen);
    if (action === "stage") target = stagingPoint;
    else {
      start = stagingPoint;
      target = workPoint;
    }
  }
  if (!start || !target) return;

  let singleBall = type.length === 1;
  let grabOffset = singleBall ? 0 : -25;
  ghostBalls[0].setAttribute("cx", grabOffset);
  ghostBalls[0].setAttribute("fill", type[0] === "B" ? "#181a17" : "white");
  ghostBalls[1].setAttribute("fill", type[1] === "B" ? "#181a17" : "white");
  ghostBalls[1].toggleAttribute("hidden", singleBall);
  ghostLink.toggleAttribute("hidden", singleBall);

  // gsap-core and gsap-performance skill
  // x/y transforms and animate autoAlpha
  ghostLayer.removeAttribute("hidden");
  ghostExampleLabel.hidden = false;
  gsap.set(ghostLayer, { autoAlpha: 0 });
  gsap.set(ghostPair, { x: start.x, y: start.y });
  gsap.set(ghostCursor, { x: start.x - 140, y: Math.max(20, start.y - 115) });
  gsap.set(ghostGrip, { autoAlpha: 0 });

  // gsap-timeline and examples/vanilla/main.js skill
  // defaults and shared positions
  ghostTimeline = gsap.timeline({
    defaults: { duration: 0.45, ease: "power2.inOut" },
    onComplete: stopGhostExample,
  });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.set(ghostPair, { x: target.x, y: target.y });
    gsap.set(ghostCursor, { x: target.x + grabOffset, y: target.y });
    ghostTimeline.to(ghostLayer, { autoAlpha: 0.62, duration: 0.15 })
      .to(ghostLayer, { autoAlpha: 0, duration: 0.15 }, "+=0.8");
    return;
  }
  ghostTimeline.to(ghostLayer, { autoAlpha: 0.62, duration: 0.2 })
    .to(ghostCursor, { x: start.x + grabOffset, y: start.y, duration: 0.75 })
    .to(ghostGrip, { autoAlpha: 1, duration: 0.15 })
    .addLabel("drag")
    .to(ghostPair, { x: target.x, y: target.y, duration: 1.1 }, "drag")
    .to(ghostCursor, { x: target.x + grabOffset, y: target.y, duration: 1.1 }, "drag")
    .addLabel("release")
    .to(ghostGrip, { autoAlpha: 0, duration: 0.15 })
    .to(ghostCursor, {
      x: Math.min(ballPlayfield.viewBox.baseVal.width - 38, target.x + 90),
      y: Math.max(20, target.y - 50),
      duration: 0.36,
    })
    .to(ghostLayer, { autoAlpha: 0, duration: 0.35 });
}

document.querySelector("#resetBalls").addEventListener("click", stopGhostExample, { capture: true });
