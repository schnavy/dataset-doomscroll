const API_ENDPOINT = "/api/random-video";
const PREFETCH_TARGET = 3;
const container = document.getElementById("video-container");

let queue = [];
let isTransitioning = false;
let touchStartY = null;
let lastAdvanceAt = 0;
const SCROLL_COOLDOWN_MS = 500;

async function fetchRandomVideoUrl() {
  const response = await fetch(API_ENDPOINT, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.status}`);
  }
  const data = await response.json();
  return data.url;
}

async function prefetchUrl(url) {
  // Prefetch strategy: load the MP4 into a blob URL so switching is instant.
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error("Prefetch failed");
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

async function fillQueue() {
  while (queue.length < PREFETCH_TARGET) {
    const url = await fetchRandomVideoUrl();
    const blobUrl = await prefetchUrl(url);
    queue.push({ originalUrl: url, blobUrl });
  }
}

function createVideoElement(src) {
  const video = document.createElement("video");
  video.src = src;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  // Repeat the current video until the user scrolls to advance.
  video.loop = true;
  return video;
}

function showVideo(entry) {
  const video = createVideoElement(entry.blobUrl);
  video.classList.add("fade-in");
  container.innerHTML = "";
  container.appendChild(video);
  console.log("Playing new video:", entry.originalUrl);
  // Best-effort play; some browsers require a user gesture.
  video.play().catch(() => {});
}

async function nextVideo() {
  if (isTransitioning) return;
  isTransitioning = true;

  if (queue.length === 0) {
    await fillQueue();
  }

  const entry = queue.shift();
  showVideo(entry);

  // Refill queue in background to keep 3 prefetched videos ready.
  fillQueue().catch(() => {});

  isTransitioning = false;
}

function handleWheel(event) {
  const now = Date.now();
  if (event.deltaY > 10 && now - lastAdvanceAt > SCROLL_COOLDOWN_MS) {
    lastAdvanceAt = now;
    console.log("Scroll detected (wheel)");
    nextVideo();
  }
}

function handleTouchStart(event) {
  if (event.touches.length === 1) {
    touchStartY = event.touches[0].clientY;
  }
}

function handleTouchMove(event) {
  if (touchStartY === null) return;
  const currentY = event.touches[0].clientY;
  const deltaY = touchStartY - currentY;

  // Swipe detection: treat a meaningful upward swipe as "next video".
  if (deltaY > 40) {
    touchStartY = null;
    const now = Date.now();
    if (now - lastAdvanceAt <= SCROLL_COOLDOWN_MS) return;
    lastAdvanceAt = now;
    console.log("Scroll detected (swipe)");
    nextVideo();
  }
}

function handleTouchEnd() {
  touchStartY = null;
}

async function init() {
  await fillQueue();
  await nextVideo();
}

window.addEventListener("wheel", handleWheel, { passive: true });
window.addEventListener("touchstart", handleTouchStart, { passive: true });
window.addEventListener("touchmove", handleTouchMove, { passive: true });
window.addEventListener("touchend", handleTouchEnd, { passive: true });

init().catch(() => {});
