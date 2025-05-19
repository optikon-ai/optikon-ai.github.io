// import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
// import { OrbitControls } from 'https://unpkg.com/three@0.152.2/examples/jsm/controls/OrbitControls.js';

// import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
// import { OrbitControls } from 'https://unpkg.com/three@0.152.2/examples/jsm/controls/OrbitControls.js';

import * as THREE from 'https://unpkg.com/three@0.126.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/TrackballControls.js';

let scene, camera, renderer, pointCloud, controls;
const SCENES = [
  { name: 'figure_1_pcs', numFrames: 92},
  { name: 'figure_2_pcs', numFrames: 144}
  // { name: 'tesla_0', numFrames: 144 }
  // { name: 'figure_3', numFrames: 80 }
];
let currentSceneIdx = 1; // default to figure_2_pcs
let loadedPointClouds = new Array(SCENES[currentSceneIdx].numFrames).fill(null);
let meanTarget = null;
let isPlaying = false;
let playInterval = null;
let slider, label, leftBtn, rightBtn, playPauseBtn;

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer();

  function resizeRendererToDisplaySize() {
    const container = document.getElementById('threejs-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = width + 'px';
    renderer.domElement.style.height = height + 'px';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  document.getElementById('threejs-container').appendChild(renderer.domElement);
  resizeRendererToDisplaySize();

  // camera.position.z = 3;

  // Set camera at the origin, looking along +z, x right, y down
  camera.position.set(0, -0.05, -0.2);
  camera.up.set(0, -1, 0); // y down
  camera.lookAt(new THREE.Vector3(0, 0, 0.2));

  // Add TrackballControls for full 3D rotation
  // controls = new OrbitControls(camera, renderer.domElement);
  controls = new TrackballControls(camera, renderer.domElement);
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = 2 * Math.PI;

  window.addEventListener('resize', resizeRendererToDisplaySize);
}

function createPointCloud(points, colors) {
  if (pointCloud) scene.remove(pointCloud);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  if (colors) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  const material = new THREE.PointsMaterial({ size: 0.006, vertexColors: !!colors });
  pointCloud = new THREE.Points(geometry, material);
  scene.add(pointCloud);

  // Set controls' target to the mean of the first point cloud only
  if (meanTarget === null) {
    let mean = [0, 0, 0];
    const N = points.length / 3;
    for (let i = 0; i < points.length; i += 3) {
      mean[0] += points[i];
      mean[1] += points[i + 1];
      mean[2] += points[i + 2];
    }
    mean = mean.map(x => x / N);
    meanTarget = mean;
    controls.target.set(mean[0], mean[1], mean[2]);
    controls.update();
  } else {
    controls.target.set(meanTarget[0], meanTarget[1], meanTarget[2]);
    controls.update();
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  renderer.render(scene, camera);
}

function loadPointCloudAndColor(frameIdx, callback) {
  const base = String(frameIdx).padStart(5, '0');
  const sceneFolder = `pointclouds/${SCENES[currentSceneIdx].name}`;
  const pcPromise = fetch(`${sceneFolder}/pointcloud_${base}.bin`).then(r => r.ok ? r.arrayBuffer() : Promise.reject('Missing pointcloud'));
  const colorPromise = fetch(`${sceneFolder}/rgb_${base}.bin`).then(r => r.ok ? r.arrayBuffer() : Promise.reject('Missing color'));
  Promise.all([pcPromise, colorPromise])
    .then(([pcBuffer, colorBuffer]) => {
      const points = new Float32Array(pcBuffer);
      const colorsUint8 = new Uint8Array(colorBuffer);
      const colors = new Float32Array(colorsUint8.length);
      for (let i = 0; i < colorsUint8.length; ++i) {
        colors[i] = colorsUint8[i] / 255.0;
      }
      callback(points, colors);
    })
    .catch(err => {
      console.error(`Failed to load frame ${frameIdx} of scene ${SCENES[currentSceneIdx].name}:`, err);
      callback(null, null); // Still call callback so loading can finish
    });
}

function preloadSceneFrames(sceneIdx, callback) {
  const numFrames = SCENES[sceneIdx].numFrames;
  let loaded = 0;
  let frames = new Array(numFrames);
  for (let i = 0; i < numFrames; ++i) {
    loadPointCloudAndColor(i, (points, colors) => {
      frames[i] = { points, colors };
      loaded++;
      if (loaded === numFrames) {
        callback(frames);
      }
    });
  }
}

function showPointCloudForFrame(frameIdx) {
  if (loadedPointClouds[frameIdx]) {
    const { points, colors } = loadedPointClouds[frameIdx];
    createPointCloud(points, colors);
  } else {
    loadPointCloudAndColor(frameIdx, (points, colors) => {
      loadedPointClouds[frameIdx] = { points, colors };
      createPointCloud(points, colors);
    });
  }
}

function updateScene(newSceneIdx) {
  const shouldResume = isPlaying;
  pauseAnimation();
  currentSceneIdx = newSceneIdx;
  const numFrames = SCENES[currentSceneIdx].numFrames;
  const slider = document.getElementById('timeSlider');
  slider.max = numFrames - 1;
  slider.value = 0;
  meanTarget = null;
  document.getElementById('loading-overlay').classList.remove('hide');
  slider.disabled = true;
  leftBtn.disabled = true;
  rightBtn.disabled = true;
  playPauseBtn.disabled = true;
  preloadSceneFrames(currentSceneIdx, (frames) => {
    loadedPointClouds = frames;
    document.getElementById('loading-overlay').classList.add('hide');
    slider.disabled = false;
    leftBtn.disabled = false;
    rightBtn.disabled = false;
    playPauseBtn.disabled = false;
    showPointCloudForFrame(0);
    if (shouldResume) playAnimation();
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function playAnimation() {
  if (isPlaying) return;
  isPlaying = true;
  playPauseBtn.innerHTML = '&#10073;&#10073;'; // Pause icon
  playInterval = setInterval(() => {
    let frame = parseInt(slider.value, 10);
    const maxFrame = SCENES[currentSceneIdx].numFrames - 1;
    if (frame < maxFrame) {
      slider.value = frame + 1;
      label.textContent = `Time: ${frame + 1}`;
      showPointCloudForFrame(frame + 1);
    } else {
      // Move to next scene and keep playing
      const nextSceneIdx = (currentSceneIdx + 1) % SCENES.length;
      updateScene(nextSceneIdx);
      // playAnimation() will be called by updateScene if needed
    }
  }, 40); // ms per frame (faster)
}

function pauseAnimation() {
  isPlaying = false;
  playPauseBtn.innerHTML = '&#9654;'; // Play icon
  if (playInterval) clearInterval(playInterval);
}

document.addEventListener('DOMContentLoaded', () => {
  initScene();
  animate();

  slider = document.getElementById('timeSlider');
  label = document.getElementById('sliderLabel');
  leftBtn = document.getElementById('sceneLeft');
  rightBtn = document.getElementById('sceneRight');
  playPauseBtn = document.getElementById('playPauseBtn');

  // Drag hint logic
  const dragHint = document.getElementById('drag-hint');
  function hideDragHint() {
    dragHint.classList.add('hide');
  }
  renderer.domElement.addEventListener('pointerdown', hideDragHint, { once: true });
  setTimeout(hideDragHint, 20000);

  // Show loading overlay and preload first scene
  document.getElementById('loading-overlay').classList.remove('hide');
  slider.disabled = true;
  leftBtn.disabled = true;
  rightBtn.disabled = true;
  playPauseBtn.disabled = true;
  preloadSceneFrames(currentSceneIdx, (frames) => {
    loadedPointClouds = frames;
    document.getElementById('loading-overlay').classList.add('hide');
    slider.disabled = false;
    leftBtn.disabled = false;
    rightBtn.disabled = false;
    playPauseBtn.disabled = false;
    showPointCloudForFrame(0);
    playAnimation();
  });

  slider.max = SCENES[currentSceneIdx].numFrames - 1;
  slider.addEventListener('input', (e) => {
    if (e.isTrusted) pauseAnimation(); // Only pause if user moved the slider
    const frame = parseInt(e.target.value, 10);
    label.textContent = `Time: ${frame}`;
    showPointCloudForFrame(frame);
  });

  leftBtn.addEventListener('click', () => {
    updateScene((currentSceneIdx - 1 + SCENES.length) % SCENES.length);
  });
  rightBtn.addEventListener('click', () => {
    updateScene((currentSceneIdx + 1) % SCENES.length);
  });

  playPauseBtn.addEventListener('click', () => {
    if (isPlaying) {
      pauseAnimation();
    } else {
      playAnimation();
    }
  });

  // Pause animation if user interacts with slider or changes scene
  slider.addEventListener('input', pauseAnimation);
}); 