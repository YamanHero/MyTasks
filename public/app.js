const defaultTasks = [
  {
    id: 1,
    title: "ترتيب السرير وتجهيز الملابس",
    category: "home",
    points: 5,
    completed: false
  },
  {
    id: 2,
    title: "دراسة رياضيات لمدة 35 دقيقة",
    category: "study",
    points: 10,
    completed: false
  },
  {
    id: 3,
    title: "استراحة هادئة لمدة 10 دقائق",
    category: "other",
    points: 3,
    completed: false
  },
  {
    id: 4,
    title: "تدريب دبلجة أو رسوم متحركة لمدة 30 دقيقة",
    category: "creative",
    points: 10,
    completed: false
  },
  {
    id: 5,
    title: "مهمة منزلية: الغسيل أو إخراج النفايات",
    category: "home",
    points: 7,
    completed: false
  }
];

const creativeIdeas = [
  {
    title: "روبوت يتعلم المشاعر",
    text: "سجّل جملة قصيرة بثلاث نبرات: هادئة، متحمسة، ومضحكة. الجملة: «أنا روبوت صغير وأحاول أن أفهم مشاعر الناس.»"
  },
  {
    title: "القطة المحققة",
    text: "اختر صوتين: القطة المحققة وصديقها. سجّل حواراً من سطرين عن البحث عن صوت مفقود."
  },
  {
    title: "البطل الهادئ",
    text: "ارسم أو صف شخصية تحل خلافاً بين صديقين بهدوء، ثم أعطها صوتاً مناسباً."
  },
  {
    title: "آلة تبديل الأصوات",
    text: "اختر شخصية عادية واجعل صوتها يتحول إلى روبوت. سجّل 20 ثانية فقط."
  },
  {
    title: "مدرسة الكواكب",
    text: "ابتكر كوكباً خجولاً يبدأ حديثاً مع كوكب آخر. جرّب قراءة جملة الترحيب بصوتين مختلفين."
  }
];

const STORAGE_KEY = "yamanHeroTasks";
const MORNING_KEY = "yamanHeroMorning";

function safeLoadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored : defaultTasks;
  } catch {
    return defaultTasks;
  }
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadMorning() {
  try {
    const saved = JSON.parse(localStorage.getItem(MORNING_KEY));
    return saved?.date === getTodayKey() ? saved : null;
  } catch {
    return null;
  }
}

let tasks = safeLoadTasks();
let morning = loadMorning();

let ticktickState = {
  configured: false,
  connected: false,
  projectName: "Hero – Yaman"
};

const tasksList = document.getElementById("tasksList");
const pointsElement = document.getElementById("points");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const heroMessage = document.getElementById("heroMessage");
const morningSummary = document.getElementById("morningSummary");

const taskModal = document.getElementById("taskModal");
const addTaskButton = document.getElementById("addTaskButton");
const closeModalButton = document.getElementById("closeModalButton");
const taskForm = document.getElementById("taskForm");

const morningModal = document.getElementById("morningModal");
const startDayButton = document.getElementById("startDayButton");
const closeMorningModalButton = document.getElementById("closeMorningModalButton");
const morningForm = document.getElementById("morningForm");

const creativeIdeaTitle = document.getElementById("creativeIdeaTitle");
const creativeIdeaText = document.getElementById("creativeIdeaText");
const addCreativeTaskButton = document.getElementById("addCreativeTaskButton");

const ticktickStatus = document.getElementById("ticktickStatus");
const ticktickConnectButton = document.getElementById("ticktickConnectButton");
const ticktickSyncButton = document.getElementById("ticktickSyncButton");

function categoryLabel(category) {
  const labels = {
    study: "دراسة",
    creative: "إبداع",
    home: "مسؤولية",
    sport: "رياضة",
    social: "مهارات اجتماعية",
    other: "مهمة يومية"
  };

  return labels[category] || "مهمة";
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function saveMorning() {
  localStorage.setItem(MORNING_KEY, JSON.stringify(morning));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCreativeIdea() {
  const dateNumber = Number(getTodayKey().replaceAll("-", ""));
  return creativeIdeas[dateNumber % creativeIdeas.length];
}

function showMessage(message) {
  heroMessage.textContent = message;
}

function showTemporaryMessage(message) {
  const original = heroMessage.textContent;

  heroMessage.textContent = message;

  window.clearTimeout(showTemporaryMessage.timer);

  showTemporaryMessage.timer = window.setTimeout(() => {
    heroMessage.textContent = original;
  }, 5000);
}

function renderTickTick() {
  if (!ticktickState.configured) {
    ticktickStatus.textContent =
      "لم يتم إعداد TickTick بعد. أضف مفاتيح الاتصال في Railway أولاً.";

    ticktickConnectButton.textContent = "إعداد TickTick";
    ticktickSyncButton.classList.add("hidden");
    return;
  }

  if (!ticktickState.connected) {
    ticktickStatus.textContent =
      "غير متصل. اضغط ربط TickTick للموافقة مرة واحدة.";

    ticktickConnectButton.textContent = "ربط TickTick";
    ticktickSyncButton.classList.add("hidden");
    return;
  }

  ticktickStatus.textContent =
    `متصل ✓ المهام الجديدة تتزامن تلقائياً مع قائمة ${ticktickState.projectName}.`;

  ticktickConnectButton.textContent = "إعادة ربط";
  ticktickSyncButton.classList.remove("hidden");
}

async function refreshTickTickStatus() {
  try {
    const response = await fetch("/api/ticktick/status", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Status request failed");
    }

    ticktickState = await response.json();
  } catch {
    ticktickState = {
      configured: false,
      connected: false,
      projectName: "Hero – Yaman"
    };
  }

  renderTickTick();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = new Error(body?.error || "تعذر الاتصال بـ TickTick.");
    error.status = response.status;
    throw error;
  }

  return body;
}

function getTaskById(id) {
  return tasks.find((task) => String(task.id) === String(id));
}

function updateTask(id, changes) {
  tasks = tasks.map((task) =>
    String(task.id) === String(id)
      ? { ...task, ...changes }
      : task
  );

  saveTasks();
  return getTaskById(id);
}

async function createTickTickTask(task) {
  if (!ticktickState.connected || task.ticktickTaskId) {
    return task;
  }

  const result = await requestJson("/api/ticktick/task", {
    method: "POST",
    body: JSON.stringify({
      title: task.title,
      category: task.category,
      points: task.points,
      completed: task.completed
    })
  });

  return updateTask(task.id, {
    ticktickTaskId: result.task.id,
    ticktickProjectId: result.task.projectId,
    ticktickCompleted: Boolean(result.task.completed)
  });
}

async function completeTickTickTask(task) {
  if (!ticktickState.connected || !task.completed || task.ticktickCompleted) {
    return task;
  }

  let currentTask = task;

  if (!currentTask.ticktickTaskId) {
    currentTask = await createTickTickTask(currentTask);

    if (currentTask.ticktickCompleted) {
      return currentTask;
    }
  }

  await requestJson("/api/ticktick/task/complete", {
    method: "POST",
    body: JSON.stringify({
      projectId: currentTask.ticktickProjectId,
      taskId: currentTask.ticktickTaskId
    })
  });

  return updateTask(currentTask.id, {
    ticktickCompleted: true
  });
}

async function syncOneTask(task) {
  let currentTask = task;

  if (!currentTask.ticktickTaskId) {
    currentTask = await createTickTickTask(currentTask);
  }

  if (currentTask.completed && !currentTask.ticktickCompleted) {
    currentTask = await completeTickTickTask(currentTask);
  }

  return currentTask;
}

async function syncAllTasksToTickTick() {
  if (!ticktickState.connected) {
    showTemporaryMessage("اربط TickTick أولاً، ثم جرّب المزامنة.");
    return;
  }

  ticktickSyncButton.disabled = true;
  ticktickSyncButton.textContent = "جارٍ المزامنة...";

  let succeeded = 0;
  let failed = 0;

  for (const task of [...tasks]) {
    try {
      await syncOneTask(task);
      succeeded += 1;
    } catch (error) {
      failed += 1;

      if (error.status === 401) {
        await refreshTickTickStatus();
        break;
      }
    }
  }

  renderTasks();
  updateDashboard();
  renderCreativeIdea();

  ticktickSyncButton.disabled = false;
  ticktickSyncButton.textContent = "مزامنة المهام الآن";

  if (failed === 0) {
    showTemporaryMessage(`تمت مزامنة ${succeeded} مهام مع TickTick.`);
  } else {
    showTemporaryMessage(
      `تمت مزامنة ${succeeded} مهام. تعذرت مزامنة ${failed} مهمة؛ جرّب إعادة الربط إذا استمرت المشكلة.`
    );
  }
}

function getTickTickNotice() {
  const url = new URL(window.location.href);
  const notice = url.searchParams.get("ticktick");

  if (!notice) {
    return null;
  }

  url.searchParams.delete("ticktick");

  window.history.replaceState(
    {},
    document.title,
    url.pathname + url.search
  );

  return notice;
}

function renderCreativeIdea() {
  const idea = getCreativeIdea();

  creativeIdeaTitle.textContent = idea.title;
  creativeIdeaText.textContent = idea.text;

  const alreadyAdded = tasks.some(
    (task) => task.creativeIdeaDate === getTodayKey()
  );

  addCreativeTaskButton.disabled = alreadyAdded;

  addCreativeTaskButton.textContent = alreadyAdded
    ? "أضيفت إلى خطة اليوم"
    : "أضفها لخطة اليوم";
}

function renderMorning() {
  if (!morning) {
    morningSummary.classList.add("hidden");

    showMessage(
      "لا تحتاج أن تفعل كل شيء دفعة واحدة. ابدأ بمهمة واحدة، ثم خذ استراحة قصيرة، وبعدها أكمل."
    );

    startDayButton.textContent = "ابدأ يومي";
    return;
  }

  const energyMessage = {
    منخفضة: "نختار أهم مهمة واحدة ونأخذ استراحة بهدوء.",
    متوسطة: "نبدأ بالخطوة الأولى ثم نكمل حسب طاقتك.",
    عالية: "طاقة جميلة اليوم. ابدأ بالأهم قبل أي شيء آخر."
  }[morning.energy] || "نبدأ بخطوة واحدة هادئة.";

  morningSummary.innerHTML = `
    <h2>خطة بداية اليوم</h2>
    <p>
      طاقتك: <strong>${escapeHtml(morning.energy)}</strong> —
      أهم خطوة: <strong>${escapeHtml(morning.priority)}</strong> —
      وقتك الممتع: <strong>${escapeHtml(morning.creativeChoice)}</strong>.<br>
      ${energyMessage}
    </p>
  `;

  morningSummary.classList.remove("hidden");

  showMessage(
    `يا يَمان، أهم شيء الآن هو: ${morning.priority}. لا تفكر في كل اليوم؛ ابدأ بها فقط.`
  );

  startDayButton.textContent = "تعديل بداية اليوم";
}

function renderTasks() {
  tasksList.innerHTML = "";

  tasks.forEach((task) => {
    const taskItem = document.createElement("article");

    taskItem.className =
      `task-card ${task.completed ? "completed" : ""}`;

    taskItem.innerHTML = `
      <label class="task-check">
        <input type="checkbox" ${task.completed ? "checked" : ""} data-id="${task.id}" />
        <span class="custom-check"></span>
      </label>

      <div class="task-content">
        <span class="task-category">${categoryLabel(task.category)}</span>
        <h3>${escapeHtml(task.title)}</h3>
      </div>

      <div class="task-points">+${task.points}</div>
    `;

    tasksList.appendChild(taskItem);
  });

  document.querySelectorAll(".task-check input").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const taskId = String(checkbox.dataset.id);
      const completed = checkbox.checked;

      const updatedTask = updateTask(taskId, { completed });

      renderTasks();
      updateDashboard();

      if (completed && ticktickState.connected) {
        try {
          await completeTickTickTask(updatedTask);
        } catch (error) {
          if (error.status === 401) {
            await refreshTickTickStatus();
          }

          showTemporaryMessage(
            "تم حفظ الإنجاز في Hero، لكن لم يكتمل التحديث في TickTick. استخدم مزامنة المهام لاحقاً."
          );
        }
      }
    });
  });
}

function updateDashboard() {
  const completedTasks = tasks.filter((task) => task.completed);

  const points = completedTasks.reduce(
    (sum, task) => sum + Number(task.points || 0),
    0
  );

  const total = tasks.length;
  const completed = completedTasks.length;

  const percentage = total
    ? Math.round((completed / total) * 100)
    : 0;

  pointsElement.textContent = points;
  progressText.textContent = `${completed} من ${total} مهام`;
  progressBar.style.width = `${percentage}%`;
}

function openTaskModal() {
  taskModal.classList.remove("hidden");
  document.getElementById("taskTitle").focus();
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
}

function openMorningModal() {
  document.querySelectorAll('input[name="energy"]').forEach((input) => {
    input.checked = input.value === morning?.energy;
  });

  document.getElementById("morningPriority").value =
    morning?.priority || "";

  document.querySelectorAll('input[name="creativeChoice"]').forEach((input) => {
    input.checked = input.value === morning?.creativeChoice;
  });

  morningModal.classList.remove("hidden");
}

function closeMorningModal() {
  morningModal.classList.add("hidden");
}

addTaskButton.addEventListener("click", openTaskModal);
closeModalButton.addEventListener("click", closeTaskModal);

taskModal.addEventListener("click", (event) => {
  if (event.target === taskModal) {
    closeTaskModal();
  }
});

startDayButton.addEventListener("click", openMorningModal);
closeMorningModalButton.addEventListener("click", closeMorningModal);

morningModal.addEventListener("click", (event) => {
  if (event.target === morningModal) {
    closeMorningModal();
  }
});

ticktickConnectButton.addEventListener("click", () => {
  if (!ticktickState.configured) {
    showTemporaryMessage(
      "צריך קודם להוסיף את פרטי TickTick ב-Railway Variables."
    );

    return;
  }

  window.location.assign("/auth/ticktick");
});

ticktickSyncButton.addEventListener("click", () => {
  syncAllTasksToTickTick();
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = document.getElementById("taskTitle").value.trim();
  const category = document.getElementById("taskCategory").value;

  const points = Number(
    document.getElementById("taskPoints").value
  );

  if (!title || !Number.isFinite(points) || points < 1) {
    return;
  }

  const newTask = {
    id: Date.now(),
    title,
    category,
    points,
    completed: false
  };

  tasks.push(newTask);

  saveTasks();
  renderTasks();
  updateDashboard();
  renderCreativeIdea();

  taskForm.reset();
  closeTaskModal();

  if (ticktickState.connected) {
    try {
      await createTickTickTask(newTask);

      showTemporaryMessage("تمت إضافة المهمة إلى Hero وTickTick.");
    } catch (error) {
      if (error.status === 401) {
        await refreshTickTickStatus();
      }

      showTemporaryMessage(
        "تمت إضافة المهمة إلى Hero، لكن لم تُرسل إلى TickTick. استخدم مزامنة المهام لاحقاً."
      );
    }
  }
});

morningForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(morningForm);

  const energy = formData.get("energy");

  const priority = String(
    formData.get("priority") || ""
  ).trim();

  const creativeChoice = formData.get("creativeChoice");

  if (!energy || !priority || !creativeChoice) {
    return;
  }

  morning = {
    date: getTodayKey(),
    energy,
    priority,
    creativeChoice
  };

  saveMorning();
  renderMorning();
  closeMorningModal();
});

addCreativeTaskButton.addEventListener("click", async () => {
  const alreadyAdded = tasks.some(
    (task) => task.creativeIdeaDate === getTodayKey()
  );

  if (alreadyAdded) {
    return;
  }

  const idea = getCreativeIdea();

  const newTask = {
    id: `${Date.now()}-creative`,
    title: `تدريب إبداعي: ${idea.title} لمدة 10 دقائق`,
    category: "creative",
    points: 10,
    completed: false,
    creativeIdeaDate: getTodayKey()
  };

  tasks.push(newTask);

  saveTasks();
  renderTasks();
  updateDashboard();
  renderCreativeIdea();

  if (ticktickState.connected) {
    try {
      await createTickTickTask(newTask);

      showTemporaryMessage("أُضيف التدريب الإبداعي إلى Hero وTickTick.");
    } catch (error) {
      if (error.status === 401) {
        await refreshTickTickStatus();
      }

      showTemporaryMessage(
        "أُضيف التدريب إلى Hero، لكن مزامنة TickTick لم تكتمل بعد."
      );
    }
  }
});

renderTasks();
updateDashboard();
renderMorning();
renderCreativeIdea();

(async () => {
  const notice = getTickTickNotice();

  await refreshTickTickStatus();

  if (notice === "connected") {
    showTemporaryMessage(
      "تم ربط TickTick بنجاح. يمكنك مزامنة مهام اليوم الآن."
    );
  }

  if (notice === "denied") {
    showTemporaryMessage(
      "لم يتم منح Hero إذن الوصول إلى TickTick."
    );
  }

  if (notice === "state_error") {
    showTemporaryMessage(
      "انتهت جلسة الربط. اضغط ربط TickTick وحاول مرة أخرى."
    );
  }
})();
