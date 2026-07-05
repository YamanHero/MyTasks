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

function renderCreativeIdea() {
  const idea = getCreativeIdea();

  creativeIdeaTitle.textContent = idea.title;
  creativeIdeaText.textContent = idea.text;

  const alreadyAdded = tasks.some(
    task => task.creativeIdeaDate === getTodayKey()
  );

  addCreativeTaskButton.disabled = alreadyAdded;
  addCreativeTaskButton.textContent = alreadyAdded
    ? "أضيفت إلى خطة اليوم"
    : "أضفها لخطة اليوم";
}

function renderMorning() {
  if (!morning) {
    morningSummary.classList.add("hidden");

    heroMessage.textContent =
      "لا تحتاج أن تفعل كل شيء دفعة واحدة. ابدأ بمهمة واحدة، ثم خذ استراحة قصيرة، وبعدها أكمل.";

    startDayButton.textContent = "ابدأ يومي";
    return;
  }

  const energyMessage = {
    "منخفضة": "نختار أهم مهمة واحدة ونأخذ استراحة بهدوء.",
    "متوسطة": "نبدأ بالخطوة الأولى ثم نكمل حسب طاقتك.",
    "عالية": "طاقة جميلة اليوم. ابدأ بالأهم قبل أي شيء آخر."
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

  heroMessage.textContent =
    `يا يَمان، أهم شيء الآن هو: ${morning.priority}. لا تفكر في كل اليوم؛ ابدأ بها فقط.`;

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
    checkbox.addEventListener("change", () => {
      const taskId = String(checkbox.dataset.id);

      tasks = tasks.map((task) =>
        String(task.id) === taskId
          ? { ...task, completed: checkbox.checked }
          : task
      );

      saveTasks();
      renderTasks();
      updateDashboard();
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

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = document.getElementById("taskTitle").value.trim();
  const category = document.getElementById("taskCategory").value;

  const points = Number(
    document.getElementById("taskPoints").value
  );

  if (!title || !Number.isFinite(points) || points < 1) {
    return;
  }

  tasks.push({
    id: Date.now(),
    title,
    category,
    points,
    completed: false
  });

  saveTasks();
  renderTasks();
  updateDashboard();
  renderCreativeIdea();

  taskForm.reset();
  closeTaskModal();
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

addCreativeTaskButton.addEventListener("click", () => {
  const alreadyAdded = tasks.some(
    task => task.creativeIdeaDate === getTodayKey()
  );

  if (alreadyAdded) {
    return;
  }

  const idea = getCreativeIdea();

  tasks.push({
    id: `${Date.now()}-creative`,
    title: `تدريب إبداعي: ${idea.title} لمدة 10 دقائق`,
    category: "creative",
    points: 10,
    completed: false,
    creativeIdeaDate: getTodayKey()
  });

  saveTasks();
  renderTasks();
  updateDashboard();
  renderCreativeIdea();
});

renderTasks();
updateDashboard();
renderMorning();
renderCreativeIdea();
