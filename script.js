let model;
let webcam;
let config;

let students = [];
let attendance = [];
let lastChecked = {};
let isRunning = false;

async function loadConfig() {
  const response = await fetch("./config.json");
  config = await response.json();
}

async function loadModel() {
  const version = new Date().getTime();

  const modelURL = config.modelPath + "model.json?v=" + version;
  const metadataURL = config.modelPath + "metadata.json?v=" + version;

  model = await tmImage.load(modelURL, metadataURL);
  const labels = model.getClassLabels();

  students = labels
    .filter(label => !isUnknown(label))
    .map(label => parseStudentFromClassName(label));

  renderStudents();

  console.log("모델 로드 완료");
  console.log("모델 클래스:", labels);
}

function parseStudentFromClassName(className) {
  const parts = className.split("_");

  if (parts.length >= 2) {
    return {
      studentId: parts[0],
      name: parts.slice(1).join("_"),
      className: className
    };
  }

  return {
    studentId: "-",
    name: className,
    className: className
  };
}

function isUnknown(className) {
  if (!config) return false;

  return config.unknownLabels.includes(className);
}

async function init() {
  if (isRunning) return;

  try {
    setStatus("설정 파일을 불러오는 중입니다.", "wait");

    await loadConfig();

    setStatus("모델을 불러오는 중입니다.", "wait");

    await loadModel();

    const width = 300;
    const height = 300;
    const flip = true;

    webcam = new tmImage.Webcam(width, height, flip);

    await webcam.setup();
    await webcam.play();

    document.getElementById("webcam-container").innerHTML = "";
    document.getElementById("webcam-container").appendChild(webcam.canvas);

    loadSavedAttendance();

    isRunning = true;

    setStatus("얼굴 인식 중입니다.", "wait");

    window.requestAnimationFrame(loop);
  } catch (error) {
    console.error(error);
    setStatus("오류가 발생했습니다. 파일 위치나 카메라 권한을 확인하세요.", "fail");
  }
}

async function loop() {
  if (!isRunning) return;

  webcam.update();

  await predict();

  window.requestAnimationFrame(loop);
}

async function predict() {
  const predictions = await model.predict(webcam.canvas);

  let bestPrediction = predictions[0];

  for (let i = 1; i < predictions.length; i++) {
    if (predictions[i].probability > bestPrediction.probability) {
      bestPrediction = predictions[i];
    }
  }

  const className = bestPrediction.className;
  const probability = bestPrediction.probability;
  const student = parseStudentFromClassName(className);

  document.getElementById("current-class").textContent = className;
  document.getElementById("current-id").textContent = student.studentId;
  document.getElementById("current-name").textContent = student.name;
  document.getElementById("current-probability").textContent =
    Math.round(probability * 100) + "%";

  if (isUnknown(className)) {
    setStatus("등록되지 않은 대상입니다.", "fail");
    return;
  }

  if (probability < config.threshold) {
    setStatus("인식률이 기준보다 낮습니다.", "wait");
    return;
  }

  markAttendance(className, probability);
}

function markAttendance(className, probability) {
  const student = parseStudentFromClassName(className);

  const now = new Date();
  const lastTime = lastChecked[className];

  if (lastTime) {
    const diffSeconds = (now - lastTime) / 1000;

    if (diffSeconds < config.cooldownSeconds) {
      setStatus(student.name + " 이미 출석 처리됨", "wait");
      return;
    }
  }

  const alreadyChecked = attendance.some(
    record => record.className === className
  );

  if (alreadyChecked) {
    setStatus(student.name + " 이미 출석 완료", "wait");
    lastChecked[className] = now;
    return;
  }

  lastChecked[className] = now;

  const record = {
    studentId: student.studentId,
    name: student.name,
    className: className,
    time: now.toLocaleString(),
    probability: Math.round(probability * 100)
  };

  attendance.push(record);

  saveAttendance();
  renderAttendance();

  setStatus(student.name + " 출석 완료", "success");
}

function renderStudents() {
  const tbody = document.querySelector("#studentTable tbody");

  tbody.innerHTML = "";

  students.forEach(student => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${student.studentId}</td>
      <td>${student.name}</td>
      <td>${student.className}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderAttendance() {
  const tbody = document.querySelector("#attendanceTable tbody");

  tbody.innerHTML = "";

  attendance.forEach(record => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${record.studentId}</td>
      <td>${record.name}</td>
      <td>${record.time}</td>
      <td>${record.probability}%</td>
      <td>${record.className}</td>
    `;

    tbody.appendChild(tr);
  });
}

function setStatus(message, type) {
  const statusEl = document.getElementById("current-status");

  statusEl.textContent = message;
  statusEl.className = "";

  if (type === "success") {
    statusEl.classList.add("status-success");
  } else if (type === "wait") {
    statusEl.classList.add("status-wait");
  } else if (type === "fail") {
    statusEl.classList.add("status-fail");
  }
}

function saveAttendance() {
  localStorage.setItem("attendanceRecords", JSON.stringify(attendance));
}

function loadSavedAttendance() {
  const saved = localStorage.getItem("attendanceRecords");

  if (saved) {
    attendance = JSON.parse(saved);
    renderAttendance();
  }
}

function clearAttendance() {
  if (!confirm("출석 기록을 초기화할까요?")) return;

  attendance = [];
  lastChecked = {};

  localStorage.removeItem("attendanceRecords");

  renderAttendance();

  setStatus("출석 기록이 초기화되었습니다.", "wait");
}

function downloadCSV() {
  if (attendance.length === 0) {
    alert("다운로드할 출석 기록이 없습니다.");
    return;
  }

  let csv = "학번,이름,출석시간,인식률,모델클래스명\n";

  attendance.forEach(record => {
    csv += `${record.studentId},${record.name},${record.time},${record.probability}%,${record.className}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "출석기록.csv";

  link.click();

  URL.revokeObjectURL(url);
}