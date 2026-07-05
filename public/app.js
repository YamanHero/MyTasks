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

let tasks = JSON.parse(localStorage.getItem("yamanHeroTasks")) || defaultTasks;

const tasksList = document.getElementById("tasksList");
const pointsElement = document.getElementById("points");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");

const taskModal = document.getElementById("taskModal");
const addTaskButton = document.getElementById("addTaskButton");
const closeModalButton = document.getElementById("closeModalButton");
const taskForm = document.getElementById("taskForm");

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
  localStorage.setItem("yamanHeroTasks", JSON.stringify(tasks));
}

function renderTasks() {
  tasksList.innerHTML = "";

  tasks.forEach((task) => {
    const taskItem = document.createElement("article");
    taskItem.className = `task-card ${task.completed ? "completed" : ""}`;

    taskItem.innerHTML = `
      <label class="task-check">
        <input type="checkbox" ${task.completed ? "checked" : ""} data-id="${task.id}" />
        <span class="custom-check"></span>
      </label>

      <div class="task-content">
        <span class="task-category">${categoryLabel(task.category)}</span>
        <h3>${task.title}</h3>
      </div>

      <div class="task-points">+${task.points}</div>
    `;

    tasksList.appendChild(taskItem);
  });

  document.querySelectorAll(".task-check input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const taskId = Number(checkbox.dataset.id);

      tasks = tasks.map((task) =>
        task.id === taskId
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
  const points = completedTasks.reduce((sum, task) => sum + task.points, 0);
  const total = tasks.length;
  const completed = completedTasks.length;
  const percentage = total ? Math.round((completed / total) * 100) : 0;

  pointsElement.textContent = points;
  progressText.textContent = `${completed} من ${total} مهام`;
  progressBar.style.width = `${percentage}%`;
}

addTaskButton.addEventListener("click", () => {
  taskModal.classList.remove("hidden");
});

closeModalButton.addEventListener("click", () => {
  taskModal.classList.add("hidden");
});

taskModal.addEventListener("click", (event) => {
  if (event.target === taskModal) {
    taskModal.classList.add("hidden");
  }
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = document.getElementById("taskTitle").value.trim();
  const category = document.getElementById("taskCategory").value;
  const points = Number(document.getElementById("taskPoints").value);

  if (!title) return;

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

  taskForm.reset();
  taskModal.classList.add("hidden");
});

renderTasks();
updateDashboard();
