// import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
// import { OrbitControls } from 'https://unpkg.com/three@0.152.2/examples/jsm/controls/OrbitControls.js';

// import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
// import { OrbitControls } from 'https://unpkg.com/three@0.152.2/examples/jsm/controls/OrbitControls.js';

import * as THREE from 'https://unpkg.com/three@0.126.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/TrackballControls.js';

let scene, camera, renderer, pointCloud, controls;
const SCENES = [
  'tesla_0'
  // 'figure_1_pcs',
  // 'figure_2_pcs',
  // 'figure_3'
];
let currentSceneIdx = 0;
let loadedPointClouds = [];
let meanTarget = null;
let isPlaying = false;
let playInterval = null;
let slider, label, leftBtn, rightBtn, playPauseBtn;
let requestVersion = 0;
let globalCache = {};
let sceneMetadata = {}; // Store metadata for each scene

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

function disposePointCloud() {
  if (pointCloud) {
    if (pointCloud.geometry) pointCloud.geometry.dispose();
    if (pointCloud.material) pointCloud.material.dispose();
    scene.remove(pointCloud);
    pointCloud = null;
  }
}

function createPointCloud(points, colors) {
  disposePointCloud();
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

async function loadSceneMetadata(sceneName) {
  if (sceneMetadata[sceneName]) return sceneMetadata[sceneName];
  
  const response = await fetch(`pointclouds/${sceneName}/metadata.txt`);
  const text = await response.text();
  const lines = text.trim().split('\n');
  
  const metadata = {
    numFrames: parseInt(lines[0]),
    minBounds: lines[1].split(' ').map(Number),
    maxBounds: lines[2].split(' ').map(Number)
  };
  
  sceneMetadata[sceneName] = metadata;
  return metadata;
}

function denormalizePoints(pointsUint16, minBounds, maxBounds) {
  const points = new Float32Array(pointsUint16.length);
  for (let i = 0; i < pointsUint16.length; i += 3) {
    points[i] = minBounds[0] + (pointsUint16[i] / 65535) * (maxBounds[0] - minBounds[0]);
    points[i + 1] = minBounds[1] + (pointsUint16[i + 1] / 65535) * (maxBounds[1] - minBounds[1]);
    points[i + 2] = minBounds[2] + (pointsUint16[i + 2] / 65535) * (maxBounds[2] - minBounds[2]);
  }
  return points;
}

async function loadPointCloudAndColor(frameIdx, callback) {
  const base = String(frameIdx).padStart(5, '0');
  const sceneFolder = `pointclouds/${SCENES[currentSceneIdx]}`;
  
  try {
    const metadata = await loadSceneMetadata(SCENES[currentSceneIdx]);
    const pcPromise = fetch(`${sceneFolder}/pointcloud_${base}.bin`).then(r => r.ok ? r.arrayBuffer() : Promise.reject('Missing pointcloud'));
    const colorPromise = fetch(`${sceneFolder}/rgb_${base}.bin`).then(r => r.ok ? r.arrayBuffer() : Promise.reject('Missing color'));
    
    const [pcBuffer, colorBuffer] = await Promise.all([pcPromise, colorPromise]);
    const pointsUint16 = new Uint16Array(pcBuffer);
    const points = denormalizePoints(pointsUint16, metadata.minBounds, metadata.maxBounds);
    
    const colorsUint8 = new Uint8Array(colorBuffer);
    const colors = new Float32Array(colorsUint8.length);
    for (let i = 0; i < colorsUint8.length; ++i) {
      colors[i] = colorsUint8[i] / 255.0;
    }
    
    callback(points, colors);
  } catch (err) {
    console.error(`Failed to load frame ${frameIdx} of scene ${SCENES[currentSceneIdx]}:`, err);
    callback(null, null);
  }
}

function showPointCloudForFrame(frameIdx, onFirstFrameLoaded) {
  requestVersion++;
  const thisRequest = requestVersion;
  const sceneName = SCENES[currentSceneIdx];
  if (!globalCache[sceneName]) {
    loadSceneMetadata(sceneName).then(metadata => {
      globalCache[sceneName] = new Array(metadata.numFrames).fill(null);
      loadFrame();
    });
  } else {
    loadFrame();
  }

  function loadFrame() {
    if (globalCache[sceneName][frameIdx]) {
      const { points, colors } = globalCache[sceneName][frameIdx];
      loadedPointClouds[frameIdx] = { points, colors };
      createPointCloud(points, colors);
      if (onFirstFrameLoaded) onFirstFrameLoaded();
    } else {
      loadPointCloudAndColor(frameIdx, (points, colors) => {
        if (thisRequest !== requestVersion) return;
        globalCache[sceneName][frameIdx] = { points, colors };
        loadedPointClouds[frameIdx] = { points, colors };
        createPointCloud(points, colors);
        if (onFirstFrameLoaded) onFirstFrameLoaded();
      });
    }
  }
}

function updateScene(newSceneIdx) {
  requestVersion++;
  const shouldResume = isPlaying;
  pauseAnimation();
  currentSceneIdx = newSceneIdx;
  
  // Load metadata first to get correct frame count
  loadSceneMetadata(SCENES[currentSceneIdx]).then(metadata => {
    const numFrames = metadata.numFrames;
    slider.max = numFrames - 1;
    slider.value = 0;
    meanTarget = null;
    
    // Use global cache if available
    const sceneName = SCENES[currentSceneIdx];
    if (!globalCache[sceneName]) globalCache[sceneName] = new Array(numFrames).fill(null);
    loadedPointClouds = globalCache[sceneName];
    
    document.getElementById('loading-overlay').classList.remove('hide');
    slider.disabled = true;
    leftBtn.disabled = true;
    rightBtn.disabled = true;
    playPauseBtn.disabled = true;
    
    showPointCloudForFrame(0, () => {
      document.getElementById('loading-overlay').classList.add('hide');
      slider.disabled = false;
      leftBtn.disabled = false;
      rightBtn.disabled = false;
      playPauseBtn.disabled = false;
      if (shouldResume) playAnimation();
    });
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

  async function advanceFrame() {
    if (!isPlaying) return;
    let frame = parseInt(slider.value, 10);
    const metadata = await loadSceneMetadata(SCENES[currentSceneIdx]);
    const maxFrame = metadata.numFrames - 1;
    
    if (frame < maxFrame) {
      slider.value = frame + 1;
      label.textContent = `Time: ${frame + 1}`;
      showPointCloudForFrame(frame + 1, () => {
        setTimeout(advanceFrame, 40); // ms per frame (faster)
      });
    } else {
      // Move to next scene and keep playing
      const nextSceneIdx = (currentSceneIdx + 1) % SCENES.length;
      updateScene(nextSceneIdx);
      // playAnimation() will be called by updateScene if needed
    }
  }

  // Start advancing from the current frame
  advanceFrame();
}

function pauseAnimation() {
  isPlaying = false;
  playPauseBtn.innerHTML = '&#9654;'; // Play icon
  // No interval to clear anymore
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize scene first
  initScene();
  animate();

  // Get UI elements
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

  // Show loading overlay
  document.getElementById('loading-overlay').classList.remove('hide');
  
  try {
    // Load metadata first
    const sceneName = SCENES[currentSceneIdx];
    const metadata = await loadSceneMetadata(sceneName);
    
    // Initialize cache and UI
    if (!globalCache[sceneName]) {
      globalCache[sceneName] = new Array(metadata.numFrames).fill(null);
    }
    loadedPointClouds = globalCache[sceneName];
    
    slider.max = metadata.numFrames - 1;
    slider.value = 0;
    label.textContent = 'Time: 0';
    
    // Disable UI while loading
    slider.disabled = true;
    leftBtn.disabled = true;
    rightBtn.disabled = true;
    playPauseBtn.disabled = true;
    
    // Load first frame
    await new Promise((resolve) => {
      showPointCloudForFrame(0, resolve);
    });
    
    // Enable UI after first frame is loaded
    document.getElementById('loading-overlay').classList.add('hide');
    slider.disabled = false;
    leftBtn.disabled = false;
    rightBtn.disabled = false;
    playPauseBtn.disabled = false;
    
    // Start animation
    playAnimation();
  } catch (err) {
    console.error('Failed to initialize scene:', err);
    document.getElementById('loading-overlay').classList.add('hide');
  }

  // Set up event listeners
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
});
