import * as THREE from 'https://unpkg.com/three@0.126.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/TrackballControls.js';

let scene, camera, renderer, pointCloud, controls;
const SCENES = [
  'tesla_0',
  'figure_1_pcs',
  'figure_2_pcs',
  'figure_3'
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
const PRELOAD_FRAMES = 10; // Number of frames to preload ahead
let preloadQueue = []; // Queue for managing preload requests
let imageCanvas, imageCtx; // Canvas for rendering images
let currentImageBitmap = null; // Store the current image bitmap
let imageCache = {}; // Cache for image bitmaps

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

  // Initialize image canvas
  imageCanvas = document.getElementById('imageCanvas');
  imageCtx = imageCanvas.getContext('2d', { alpha: false }); // Disable alpha for better performance
  
  // Set canvas size to match container
  function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    imageCanvas.width = container.clientWidth;
    imageCanvas.height = container.clientHeight;
  }
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
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
    
    // Load point cloud and color images
    const [pcResponse, colorResponse] = await Promise.all([
      fetch(`${sceneFolder}/pointcloud_${base}.png`),
      fetch(`${sceneFolder}/rgb_${base}.png`)
    ]);
    
    const [pcArrayBuffer, colorArrayBuffer] = await Promise.all([
      pcResponse.arrayBuffer(),
      colorResponse.arrayBuffer()
    ]);
    
    // Decode PNGs using UPNG
    const pcPNG = UPNG.decode(pcArrayBuffer);
    const colorPNG = UPNG.decode(colorArrayBuffer);
    
    // Create ImageData from colorPNG
    const expectedLength = colorPNG.width * colorPNG.height * 4;
    // console.log('Expected data length:', expectedLength);
    // console.log('Source data length:', colorPNG.data.length);
    
    const rgbaData = new Uint8ClampedArray(expectedLength);
    // Copy only the expected amount of data
    for (let i = 0; i < expectedLength; i++) {
      rgbaData[i] = colorPNG.data[i];
    }
    // Set all alpha values to 255 (fully opaque)
    for (let i = 3; i < expectedLength; i += 4) {
      rgbaData[i] = 255;
    }
    
    // console.log('Image dimensions:', colorPNG.width, 'x', colorPNG.height);
    // console.log('RGBA array length:', rgbaData.length);
    
    const imageData = new ImageData(rgbaData, colorPNG.width, colorPNG.height);
    const imageBitmap = await createImageBitmap(imageData);
    
    // Store the image bitmap in the cache
    if (!imageCache[SCENES[currentSceneIdx]]) {
      imageCache[SCENES[currentSceneIdx]] = new Array(metadata.numFrames).fill(null);
    }
    imageCache[SCENES[currentSceneIdx]][frameIdx] = imageBitmap;
    
    const numPoints = pcPNG.width * pcPNG.height;
    
    // Get uint16 data directly from PNG
    const rawData = new Uint8Array(pcPNG.data.buffer);
    const uint16Data = new Uint16Array(numPoints * 3); // 3 channels (x,y,z) as uint16
    const colorData = new Uint8Array(colorPNG.data.buffer);
    
    // Process uint16 values
    for (let i = 0; i < numPoints * 3; i++) {
      const offset = i * 2;
      // Big-endian (high byte first)
      uint16Data[i] = ((rawData[offset] << 8) | rawData[offset + 1]);
    }
    
    const points = new Float32Array(numPoints * 3);
    const colors = new Float32Array(numPoints * 3);
    let validPointCount = 0;
    
    for (let i = 0; i < numPoints; i++) {
      const pcOffset = i * 3; // 3 channels (x,y,z) as uint16
      const colorOffset = i * 4; // 4 channels (r,g,b,valid) as uint8
      
      // Read uint16 values - swap x and z to match Python order
      const z = uint16Data[pcOffset];     // was x
      const y = uint16Data[pcOffset + 1]; // y stays the same
      const x = uint16Data[pcOffset + 2]; // was z
      const valid = colorData[colorOffset + 3]; // validity is now in the 4th channel of color image
      
      if (valid > 0) {
        // Denormalize coordinates
        points[validPointCount * 3] = metadata.minBounds[0] + (x / 65535) * (metadata.maxBounds[0] - metadata.minBounds[0]);
        points[validPointCount * 3 + 1] = metadata.minBounds[1] + (y / 65535) * (metadata.maxBounds[1] - metadata.minBounds[1]);
        points[validPointCount * 3 + 2] = metadata.minBounds[2] + (z / 65535) * (metadata.maxBounds[2] - metadata.minBounds[2]);
        
        // Apply colors
        colors[validPointCount * 3] = colorData[colorOffset] / 255.0;     // R
        colors[validPointCount * 3 + 1] = colorData[colorOffset + 1] / 255.0; // G
        colors[validPointCount * 3 + 2] = colorData[colorOffset + 2] / 255.0; // B
        
        validPointCount++;
      }
    }
    
    // Trim arrays to actual size
    const finalPoints = points.slice(0, validPointCount * 3);
    const finalColors = colors.slice(0, validPointCount * 3);
    
    callback(finalPoints, finalColors);
  } catch (err) {
    console.error(`Failed to load frame ${frameIdx} of scene ${SCENES[currentSceneIdx]}:`, err);
    callback(null, null);
  }
}

function renderImageToCanvas(imageBitmap) {
  if (!imageBitmap || !imageCtx) return;
  
  // Calculate aspect ratio preserving dimensions
  const canvasAspect = imageCanvas.width / imageCanvas.height;
  const imageAspect = imageBitmap.width / imageBitmap.height;
  
  let drawWidth, drawHeight, offsetX = 0, offsetY = 0;
  
  if (canvasAspect > imageAspect) {
    // Canvas is wider than image
    drawHeight = imageCanvas.height;
    drawWidth = drawHeight * imageAspect;
    offsetX = (imageCanvas.width - drawWidth) / 2;
  } else {
    // Canvas is taller than image
    drawWidth = imageCanvas.width;
    drawHeight = drawWidth / imageAspect;
    offsetY = (imageCanvas.height - drawHeight) / 2;
  }
  
  // Only clear the area where we'll draw the new image
  imageCtx.clearRect(offsetX, offsetY, drawWidth, drawHeight);
  
  // Draw the new image
  imageCtx.drawImage(imageBitmap, offsetX, offsetY, drawWidth, drawHeight);
}

// Helper function to load images
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Required for loading from different domains
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function preloadFrames(startFrame, numFrames) {
  const sceneName = SCENES[currentSceneIdx];
  const metadata = await loadSceneMetadata(sceneName);
  const maxFrame = metadata.numFrames - 1;
  
  // Clear any existing preload requests
  preloadQueue = [];
  
  // Create array of frames to preload
  const framesToLoad = [];
  for (let i = 1; i <= numFrames; i++) {
    const frame = startFrame + i;
    if (frame <= maxFrame && !globalCache[sceneName]?.[frame]) {
      framesToLoad.push(frame);
    }
  }
  
  // Load frames in parallel
  const loadPromises = framesToLoad.map(frame => 
    new Promise((resolve) => {
      loadPointCloudAndColor(frame, (points, colors) => {
        if (points && colors) {
          globalCache[sceneName][frame] = { points, colors };
        }
        resolve();
      });
    })
  );
  
  // Add to preload queue
  preloadQueue.push(Promise.all(loadPromises));
}

async function loadImageForFrame(frameIdx, sceneName) {
  const base = String(frameIdx).padStart(5, '0');
  const sceneFolder = `pointclouds/${sceneName}`;
  
  try {
    const colorResponse = await fetch(`${sceneFolder}/rgb_${base}.png`);
    const colorArrayBuffer = await colorResponse.arrayBuffer();
    const colorPNG = UPNG.decode(colorArrayBuffer);
    
    // Create ImageData from colorPNG
    const expectedLength = colorPNG.width * colorPNG.height * 4;
    console.log('Expected data length:', expectedLength);
    console.log('Source data length:', colorPNG.data.length);
    
    const rgbaData = new Uint8ClampedArray(expectedLength);
    // Copy only the expected amount of data
    for (let i = 0; i < expectedLength; i++) {
      rgbaData[i] = colorPNG.data[i];
    }
    // Set all alpha values to 255 (fully opaque)
    for (let i = 3; i < expectedLength; i += 4) {
      rgbaData[i] = 255;
    }
    
    console.log('Image dimensions:', colorPNG.width, 'x', colorPNG.height);
    console.log('RGBA array length:', rgbaData.length);
    
    const imageData = new ImageData(rgbaData, colorPNG.width, colorPNG.height);
    return await createImageBitmap(imageData);
  } catch (err) {
    console.error(`Failed to load image for frame ${frameIdx}:`, err);
    return null;
  }
}

function showPointCloudForFrame(frameIdx, onFirstFrameLoaded) {
  requestVersion++;
  const thisRequest = requestVersion;
  const sceneName = SCENES[currentSceneIdx];
  
  // Initialize caches if they don't exist
  if (!globalCache[sceneName]) {
    loadSceneMetadata(sceneName).then(metadata => {
      if (!globalCache[sceneName]) {
        globalCache[sceneName] = new Array(metadata.numFrames).fill(null);
      }
      if (!imageCache[sceneName]) {
        imageCache[sceneName] = new Array(metadata.numFrames).fill(null);
      }
      loadFrame();
    });
  } else {
    loadFrame();
  }

  function loadFrame() {
    // Always try to render the image first, whether cached or not
    if (imageCache[sceneName]?.[frameIdx]) {
      renderImageToCanvas(imageCache[sceneName][frameIdx]);
    }

    if (globalCache[sceneName][frameIdx]) {
      const { points, colors } = globalCache[sceneName][frameIdx];
      loadedPointClouds[frameIdx] = { points, colors };
      createPointCloud(points, colors);
      if (onFirstFrameLoaded) onFirstFrameLoaded();
      
      // Start preloading next frames
      if (isPlaying) {
        preloadFrames(frameIdx, PRELOAD_FRAMES);
      }
    } else {
      loadPointCloudAndColor(frameIdx, (points, colors) => {
        if (thisRequest !== requestVersion) return;
        globalCache[sceneName][frameIdx] = { points, colors };
        loadedPointClouds[frameIdx] = { points, colors };
        createPointCloud(points, colors);
        if (onFirstFrameLoaded) onFirstFrameLoaded();
        
        // Start preloading next frames
        if (isPlaying) {
          preloadFrames(frameIdx, PRELOAD_FRAMES);
        }
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
    
    // Initialize caches for the new scene
    const sceneName = SCENES[currentSceneIdx];
    if (!globalCache[sceneName]) {
      globalCache[sceneName] = new Array(numFrames).fill(null);
    }
    if (!imageCache[sceneName]) {
      imageCache[sceneName] = new Array(numFrames).fill(null);
    }
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
