const DB_NAME = "meter-recti-db";
const DB_VERSION = 2;
const SETTINGS_STORE = "settings";
const HISTORY_STORE = "history";
const MQTT_SETTINGS_KEY = "mqtt";
const SPLASH_DELAY_MS = 4500;
const MAX_METER_READING = 999999999;
const CALIBRATION_TIMEOUT_MS = 120000;
const SCAN_FORMATS = [
  "QR_CODE",
  "CODE_128",
  "CODE_39",
  "EAN_13",
  "EAN_8",
  "ITF",
  "CODABAR",
];

const splashView = document.querySelector("#splashView");
const settingsView = document.querySelector("#settingsView");
const calibrationView = document.querySelector("#calibrationView");
const historyView = document.querySelector("#historyView");
const splashStatus = document.querySelector("#splashStatus");
const mqttForm = document.querySelector("#mqttForm");
const formMessage = document.querySelector("#formMessage");
const connectionBadge = document.querySelector("#connectionBadge");
const disconnectButton = document.querySelector("#disconnectButton");
const goCalibrationButton = document.querySelector("#goCalibrationButton");
const goSettingsButton = document.querySelector("#goSettingsButton");
const goHistoryButton = document.querySelector("#goHistoryButton");
const backCalibrationButton = document.querySelector("#backCalibrationButton");
const calibrationBadge = document.querySelector("#calibrationBadge");
const calibrationForm = document.querySelector("#calibrationForm");
const calibrationMessage = document.querySelector("#calibrationMessage");
const serialNumberInput = document.querySelector("#serialNumber");
const meterReadingInput = document.querySelector("#meterReading");
const scanButton = document.querySelector("#scanButton");
const scannerVideo = document.querySelector("#scannerVideo");
const html5QrReader = document.querySelector("#html5QrReader");
const scannerPlaceholder = document.querySelector("#scannerPlaceholder");
const historyList = document.querySelector("#historyList");
const historyMessage = document.querySelector("#historyMessage");

let mqttClient = null;
let currentSettings = null;
let calibrationSession = null;
let scannerStream = null;
let scannerActive = false;
let html5QrCode = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSetting(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, "readonly");
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function writeSetting(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, "readwrite");
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function addHistoryRecord(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(HISTORY_STORE);
    const request = store.add(record);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function readHistoryRecords() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE, "readonly");
    const store = transaction.objectStore(HISTORY_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

function showSettings() {
  splashView.classList.add("hidden");
  calibrationView.classList.add("hidden");
  historyView.classList.add("hidden");
  settingsView.classList.remove("hidden");
}

function showCalibration() {
  splashView.classList.add("hidden");
  settingsView.classList.add("hidden");
  historyView.classList.add("hidden");
  calibrationView.classList.remove("hidden");
}

async function showHistory() {
  splashView.classList.add("hidden");
  settingsView.classList.add("hidden");
  calibrationView.classList.add("hidden");
  historyView.classList.remove("hidden");
  await renderHistory();
}

function setBadge(state, text) {
  const className = `badge ${state || ""}`.trim();
  connectionBadge.className = className;
  connectionBadge.textContent = text;
  calibrationBadge.className = className;
  calibrationBadge.textContent = text;
}

function setConnectionMessage(text) {
  formMessage.textContent = text;
  calibrationMessage.textContent = text;
}

function normalizeWsEndpoint(endpoint) {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(trimmedEndpoint)) {
    return trimmedEndpoint.replace(/^WS/i, "ws");
  }
  return trimmedEndpoint.replace(/^\/+/, "");
}

function endpointHasPort(endpoint) {
  const hostPart = String(endpoint || "").split("/")[0];
  return /:\d+$/.test(hostPart);
}

function getFormData() {
  const data = new FormData(mqttForm);
  const rawEndpoint = String(data.get("wsEndpoint") || "").trim();

  return {
    wsEndpoint: normalizeWsEndpoint(rawEndpoint),
    port: Number(data.get("port")) || null,
    username: String(data.get("username") || "").trim(),
    password: String(data.get("password") || ""),
    subscribeTopic: String(data.get("subscribeTopic") || "").trim(),
    publishTopic: String(data.get("publishTopic") || "").trim(),
  };
}

function fillForm(settings) {
  if (!settings) return;
  mqttForm.elements.wsEndpoint.value = settings.wsEndpoint || settings.wsHost || settings.wssHost || "";
  mqttForm.elements.port.value = settings.port || "";
  mqttForm.elements.username.value = settings.username || "";
  mqttForm.elements.password.value = settings.password || "";
  mqttForm.elements.subscribeTopic.value = settings.subscribeTopic || "";
  mqttForm.elements.publishTopic.value = settings.publishTopic || "";
}

function buildWsUrl(settings) {
  const endpoint = settings.wsEndpoint || settings.wsHost || settings.wssHost || "";
  if (/^wss?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  if (endpointHasPort(endpoint)) {
    return `ws://${endpoint}`;
  }
  return `ws://${endpoint}:${settings.port}/mqtt`;
}

function hasCompleteMqttSettings(settings) {
  const endpoint = settings?.wsEndpoint || settings?.wsHost || settings?.wssHost;
  if (/^wss?:\/\//i.test(endpoint || "")) {
    return Boolean(settings && endpoint && settings.subscribeTopic && settings.publishTopic);
  }
  return Boolean(
    settings &&
    endpoint &&
    (endpointHasPort(endpoint) || settings.port) &&
    settings.subscribeTopic &&
    settings.publishTopic
  );
}

function isMqttConnected() {
  return Boolean(mqttClient && mqttClient.connected);
}

function connectMqtt(settings) {
  if (!window.mqtt) {
    setBadge("error", "缺少 MQTT 库");
    return false;
  }

  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  currentSettings = settings;
  calibrationSession = null;

  const options = {
    clientId: `meter-recti-${Date.now()}`,
    username: settings.username || undefined,
    password: settings.password || undefined,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 8000,
    clean: true,
  };

  const connectionUrl = buildWsUrl(settings);
  setBadge("", "连接中");
  setConnectionMessage(`正在连接 MQTT：${connectionUrl}`);
  mqttClient = window.mqtt.connect(connectionUrl, options);

  mqttClient.on("connect", () => {
    setBadge("connected", "已连接");
    setConnectionMessage(`MQTT 已连接：${connectionUrl}`);
    showCalibration();
  });

  mqttClient.on("message", handleMqttMessage);
  mqttClient.on("reconnect", () => {
    setBadge("", "重连中");
    setConnectionMessage(`MQTT 正在重连：${connectionUrl}`);
  });
  mqttClient.on("offline", () => {
    setBadge("error", "离线");
    setConnectionMessage(`MQTT 已离线，请检查网络或服务器：${connectionUrl}`);
  });
  mqttClient.on("close", () => {
    if (!mqttClient) return;
    setBadge("error", "已关闭");
    setConnectionMessage(`MQTT 连接已关闭：${connectionUrl}`);
  });
  mqttClient.on("error", (error) => {
    setBadge("error", "连接错误");
    setConnectionMessage(`MQTT 连接错误：${error?.message || "未知错误"}；地址：${connectionUrl}`);
  });

  return true;
}

function disconnectMqtt() {
  if (!mqttClient) {
    setBadge("", "未连接");
    formMessage.textContent = "当前没有活动的 MQTT 连接。";
    calibrationMessage.textContent = "当前没有活动的 MQTT 连接。";
    return;
  }

  mqttClient.end(true);
  mqttClient = null;
  calibrationSession = null;
  setBadge("", "已断开");
  formMessage.textContent = "MQTT 连接已手动断开。";
  calibrationMessage.textContent = "MQTT 连接已手动断开。";
}

function appendSerialTopic(baseTopic, serialNumber) {
  return `${baseTopic || ""}${serialNumber}`;
}

function parseJsonPayload(payload) {
  try {
    return JSON.parse(payload.toString());
  } catch {
    return null;
  }
}

function validateCalibrationInputs() {
  const serialNumber = serialNumberInput.value.trim();
  const readingText = meterReadingInput.value.trim();

  if (!serialNumber) {
    return { error: "请输入或扫描序列号。" };
  }

  if (!/^\d+$/.test(readingText)) {
    return { error: "表盘读数必须为整数。" };
  }

  const meterReading = Number(readingText);
  if (!Number.isSafeInteger(meterReading) || meterReading > MAX_METER_READING) {
    return { error: "表盘读数不能大于 999999999。" };
  }

  return { serialNumber, meterReading: readingText };
}

function startCalibrationTimeout() {
  window.clearTimeout(calibrationSession?.timeoutId);
  calibrationSession.timeoutId = window.setTimeout(() => {
    calibrationMessage.textContent = "等待设备上传超时，请检查设备或 MQTT 主题。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "超时";
    calibrationSession = null;
  }, CALIBRATION_TIMEOUT_MS);
}

function handleMqttMessage(topic, payload, packet) {
  if (!calibrationSession || topic !== calibrationSession.subscribeTopic) {
    return;
  }

  if (packet?.retain) {
    calibrationMessage.textContent = "已忽略 MQTT 保留消息，继续等待设备实时上传...";
    return;
  }

  const message = parseJsonPayload(payload);
  if (!message || String(message.SN || "") !== calibrationSession.serialNumber) {
    return;
  }

  if (
    calibrationSession.stage === "waiting-m0" &&
    message.DEVTYPE === "M0"
  ) {
    calibrationSession.stage = "sending-command";
    calibrationMessage.textContent = "收到 M0，正在发送校准指令...";
    window.clearTimeout(calibrationSession.timeoutId);

    window.setTimeout(() => {
      if (!calibrationSession || !isMqttConnected()) return;
      const command = `D3${calibrationSession.serialNumber}B2${calibrationSession.meterReading}`;
      mqttClient.publish(calibrationSession.publishTopic, command, (error) => {
        if (error) {
          calibrationMessage.textContent = "校准指令发送失败，请检查 MQTT 连接。";
          calibrationBadge.className = "badge error";
          calibrationBadge.textContent = "发送失败";
          calibrationSession = null;
          return;
        }

        calibrationSession.stage = "waiting-m1";
        calibrationSession.commandSentAt = Date.now();
        calibrationMessage.textContent = "校准指令已发送，等待设备重启并回传 M1...";
        calibrationBadge.className = "badge";
        calibrationBadge.textContent = "等待 M1";
        startCalibrationTimeout();
      });
    }, 100);
    return;
  }

  if (
    calibrationSession.stage === "waiting-m1" &&
    message.DEVTYPE === "M1" &&
    Object.prototype.hasOwnProperty.call(message, "METERSUM")
  ) {
    completeCalibration(message);
  }
}

async function completeCalibration(message) {
  const session = calibrationSession;
  window.clearTimeout(session?.timeoutId);

  const now = new Date();
  const record = {
    sn: String(message.SN || session.serialNumber),
    meterSum: String(message.METERSUM || ""),
    calibratedAt: now.toLocaleString("zh-CN", { hour12: false }),
    timestamp: now.toISOString(),
    raw: message,
  };

  try {
    await addHistoryRecord(record);
    calibrationMessage.textContent = "校准成功，历史记录已保存。";
    calibrationBadge.className = "badge connected";
    calibrationBadge.textContent = "校准成功";
    serialNumberInput.value = "";
    meterReadingInput.value = "";
  } catch {
    calibrationMessage.textContent = "校准成功，但历史记录保存失败。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "保存失败";
  } finally {
    calibrationSession = null;
  }
}

function createHistoryRow(record) {
  const row = document.createElement("div");
  row.className = "history-row";

  const sn = document.createElement("span");
  sn.textContent = record.sn || "";

  const meterSum = document.createElement("span");
  meterSum.textContent = record.meterSum || "";

  const calibratedAt = document.createElement("span");
  calibratedAt.textContent = record.calibratedAt || record.timestamp || "";

  row.append(sn, meterSum, calibratedAt);
  return row;
}

async function renderHistory() {
  historyList.textContent = "";
  historyMessage.textContent = "";

  try {
    const records = await readHistoryRecords();
    const sortedRecords = records.sort((a, b) => (b.id || 0) - (a.id || 0));

    if (sortedRecords.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-history";
      empty.textContent = "暂无历史记录";
      historyList.append(empty);
      return;
    }

    sortedRecords.forEach((record) => {
      historyList.append(createHistoryRow(record));
    });
    historyMessage.textContent = `共 ${sortedRecords.length} 条记录。`;
  } catch {
    historyMessage.textContent = "读取历史记录失败。";
  }
}

async function beginCalibration() {
  const validated = validateCalibrationInputs();
  if (validated.error) {
    calibrationMessage.textContent = validated.error;
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "输入错误";
    return;
  }

  if (!isMqttConnected()) {
    calibrationMessage.textContent = "MQTT 未连接，请先连接后再校准。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "未连接";
    return;
  }

  if (!currentSettings) {
    currentSettings = await readSetting(MQTT_SETTINGS_KEY);
  }

  const subscribeTopic = appendSerialTopic(currentSettings.subscribeTopic, validated.serialNumber);
  const publishTopic = appendSerialTopic(currentSettings.publishTopic, validated.serialNumber);

  if (calibrationSession?.subscribeTopic) {
    mqttClient.unsubscribe(calibrationSession.subscribeTopic);
  }

  calibrationSession = {
    stage: "waiting-m0",
    serialNumber: validated.serialNumber,
    meterReading: validated.meterReading,
    subscribeTopic,
    publishTopic,
    timeoutId: null,
  };

  mqttClient.subscribe(subscribeTopic, (error) => {
    if (error) {
      calibrationMessage.textContent = "订阅主题失败，请检查 MQTT 连接。";
      calibrationBadge.className = "badge error";
      calibrationBadge.textContent = "订阅失败";
      calibrationSession = null;
      return;
    }

    calibrationMessage.textContent = `已订阅 ${subscribeTopic}，等待 M0 上传...`;
    calibrationBadge.className = "badge";
    calibrationBadge.textContent = "等待 M0";
    startCalibrationTimeout();
  });
}

async function loadMqttLibrary() {
  if (window.mqtt) return true;

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/mqtt/dist/mqtt.min.js";
    script.async = true;
    script.onload = () => resolve(Boolean(window.mqtt));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function loadHtml5QrcodeLibrary() {
  if (window.Html5Qrcode) return true;

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/html5-qrcode";
    script.async = true;
    script.onload = () => resolve(Boolean(window.Html5Qrcode));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function startScanner() {
  if (!window.isSecureContext) {
    calibrationMessage.textContent = "扫码需要 HTTPS 安全页面。手机访问普通 HTTP 地址时，iOS 浏览器会禁用摄像头。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "需要 HTTPS";
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    calibrationMessage.textContent = "当前浏览器无法打开摄像头，请检查 HTTPS、浏览器权限或改用 Safari 测试。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "摄像头不可用";
    return;
  }

  if (!("BarcodeDetector" in window)) {
    await startHtml5QrcodeScanner();
    return;
  }

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch {
    calibrationMessage.textContent = "无法打开摄像头，请检查浏览器权限。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "摄像头失败";
    return;
  }

  scannerVideo.srcObject = scannerStream;
  scannerVideo.classList.remove("hidden");
  html5QrReader.classList.add("hidden");
  scannerPlaceholder.classList.add("hidden");
  await scannerVideo.play();

  scannerActive = true;
  scanButton.textContent = "停止扫码";
  calibrationMessage.textContent = "正在扫码...";

  let detector = null;
  try {
    detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
  } catch {
    detector = new BarcodeDetector();
  }

  const scanFrame = async () => {
    if (!scannerActive) return;
    try {
      const codes = await detector.detect(scannerVideo);
      if (codes.length > 0) {
        serialNumberInput.value = codes[0].rawValue.trim();
        stopScanner();
        calibrationMessage.textContent = "扫码成功，序列号已填入。";
        return;
      }
    } catch {
      calibrationMessage.textContent = "扫码解析失败，请调整距离或手动输入。";
    }
    window.requestAnimationFrame(scanFrame);
  };

  window.requestAnimationFrame(scanFrame);
}

async function startHtml5QrcodeScanner() {
  const libraryReady = await loadHtml5QrcodeLibrary();
  if (!libraryReady) {
    calibrationMessage.textContent = "扫码库加载失败，请检查网络，或先手动输入序列号。";
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "扫码库失败";
    return;
  }

  scannerActive = true;
  scanButton.textContent = "停止扫码";
  scannerVideo.classList.add("hidden");
  html5QrReader.classList.remove("hidden");
  scannerPlaceholder.classList.add("hidden");
  calibrationMessage.textContent = "正在启动兼容扫码...";
  calibrationBadge.className = "badge";
  calibrationBadge.textContent = "扫码中";

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("html5QrReader");
  }

  const qrboxSize = Math.min(
    Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.78),
    380
  );
  const supportedFormats = SCAN_FORMATS
    .map((format) => window.Html5QrcodeSupportedFormats?.[format])
    .filter((format) => format !== undefined);

  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 18,
        qrbox: { width: qrboxSize, height: qrboxSize },
        aspectRatio: 1,
        formatsToSupport: supportedFormats.length ? supportedFormats : undefined,
        disableFlip: true,
      },
      (decodedText) => {
        serialNumberInput.value = decodedText.trim();
        stopScanner();
        calibrationMessage.textContent = "扫码成功，序列号已填入。";
        calibrationBadge.className = "badge connected";
        calibrationBadge.textContent = "扫码成功";
      },
      () => {}
    );
    calibrationMessage.textContent = "正在扫码...";
  } catch (error) {
    scannerActive = false;
    scanButton.textContent = "开始扫码";
    html5QrReader.classList.add("hidden");
    scannerPlaceholder.classList.remove("hidden");
    calibrationMessage.textContent = `无法启动扫码：${error?.message || error || "未知错误"}。请检查摄像头权限。`;
    calibrationBadge.className = "badge error";
    calibrationBadge.textContent = "扫码失败";
  }
}

function stopScanner() {
  scannerActive = false;

  if (html5QrCode?.isScanning) {
    html5QrCode.stop().catch(() => {});
  }

  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  scannerVideo.pause();
  scannerVideo.srcObject = null;
  scannerVideo.classList.add("hidden");
  html5QrReader.classList.add("hidden");
  scannerPlaceholder.classList.remove("hidden");
  scanButton.textContent = "开始扫码";
}

async function handleStartup() {
  let settings = null;

  try {
    settings = await readSetting(MQTT_SETTINGS_KEY);
    currentSettings = settings;
    fillForm(settings);
  } catch {
    splashStatus.textContent = "无法读取本地设置，将进入设置页。";
  }

  await new Promise((resolve) => setTimeout(resolve, SPLASH_DELAY_MS));

  if (!hasCompleteMqttSettings(settings)) {
    splashStatus.textContent = "尚未配置 MQTT。";
    showSettings();
    return;
  }

  splashStatus.textContent = "正在连接 MQTT...";
  showSettings();
  const libraryReady = await loadMqttLibrary();
  if (!libraryReady) {
    formMessage.textContent = "设置已读取，但 MQTT 库加载失败。请检查网络或改用本地库。";
    setBadge("error", "库加载失败");
    return;
  }
  connectMqtt(settings);
}

mqttForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  const settings = getFormData();
  if (!hasCompleteMqttSettings(settings)) {
    formMessage.textContent = "请填写完整 WS/WSS 地址、订阅主题和发布主题。";
    return;
  }

  try {
    await writeSetting(MQTT_SETTINGS_KEY, settings);
    currentSettings = settings;
    formMessage.textContent = "设置已保存，正在连接 MQTT...";
  } catch {
    formMessage.textContent = "保存失败，请检查浏览器是否允许本地存储。";
    return;
  }

  const libraryReady = await loadMqttLibrary();
  if (!libraryReady) {
    formMessage.textContent = "设置已保存，但 MQTT 库加载失败。";
    setBadge("error", "库加载失败");
    return;
  }

  connectMqtt(settings);
});

disconnectButton.addEventListener("click", disconnectMqtt);
goSettingsButton.addEventListener("click", showSettings);
goCalibrationButton.addEventListener("click", showCalibration);
goHistoryButton.addEventListener("click", showHistory);
backCalibrationButton.addEventListener("click", showCalibration);

calibrationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  beginCalibration();
});

scanButton.addEventListener("click", () => {
  if (scannerActive) {
    stopScanner();
    return;
  }
  startScanner();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // The app still works online if service worker registration is unavailable.
    });
  });
}

handleStartup();
