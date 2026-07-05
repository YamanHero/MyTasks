const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Yaman Hero",
    message: "الخادم يعمل بنجاح"
  });
});

app.listen(PORT, () => {
  console.log(`Yaman Hero is running on port ${PORT}`);
});
