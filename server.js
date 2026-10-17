const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());
// Solo se sirve /public (antes se exponía todo el proyecto, incluido server.js)
app.use(express.static(path.join(__dirname, "public")));
["get", "post", "patch", "delete"].forEach(m => {
  const orig = app[m].bind(app);
  app[m] = (p, ...hs) => orig(p, ...hs.map(f => (req, res, next) =>
    Promise.resolve(f(req, res, next)).catch(e => {
      console.log("❌", e.message);
      res.status(500).json({ error: String(e.message).slice(0, 300) });
    })));
});
const SECRET = process.env.JWT_SECRET || "cambia-este-secreto";

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch(err => console.log("❌ Error:", err.message));

// ---------- MODELOS ----------
const Usuario = mongoose.model("Usuario", new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
}));

const Ticket = mongoose.model("Ticket", new mongoose.Schema({
  titulo: { type: String, required: true },
  descripcion: String,
  prioridad: { type: String, enum: ["baja", "media", "alta"], default: "media" },
  estado: { type: String, enum: ["abierto", "en_progreso", "cerrado"], default: "abierto" },
  creador: String,
  fecha: { type: Date, default: Date.now }
}));

const Tarea = mongoose.model("Tarea", new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", required: true },
  titulo: { type: String, required: true },
  hecha: { type: Boolean, default: false },
  fecha: { type: Date, default: Date.now }
}));

// El chat original pasa a ser el hilo de comentarios de cada ticket
const Mensaje = mongoose.model("Mensaje", new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", required: true },
  de: String,
  mensaje: String,
  fecha: { type: Date, default: Date.now }
}));

// ---------- AUTH ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, SECRET).username;
    next();
  } catch {
    res.status(401).json({ error: "No autorizado" });
  }
}

app.post("/registro", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Faltan datos" });
    await new Usuario({ username, password: await bcrypt.hash(password, 10) }).save();
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "Usuario ya existe" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await Usuario.findOne({ username });
  if (!user || !(await bcrypt.compare(password || "", user.password)))
    return res.status(401).json({ error: "Credenciales incorrectas" });
  const token = jwt.sign({ username }, SECRET, { expiresIn: "8h" });
  res.json({ ok: true, username, token });
});

// ---------- TICKETS ----------
app.get("/tickets", auth, async (req, res) => {
res.json((await Ticket.find()).sort((a, b) => b.fecha - a.fecha));
});

app.post("/tickets", auth, async (req, res) => {
  const { titulo, descripcion, prioridad } = req.body;
  if (!titulo) return res.status(400).json({ error: "El título es obligatorio" });
  res.json(await new Ticket({ titulo, descripcion, prioridad, creador: req.user }).save());
});

app.patch("/tickets/:id", auth, async (req, res) => {
  const { estado, prioridad, titulo, descripcion } = req.body;
  const t = await Ticket.findByIdAndUpdate(
    req.params.id, { estado, prioridad, titulo, descripcion }, { new: true, omitUndefined: true });
  t ? res.json(t) : res.status(404).json({ error: "No existe" });
});

app.delete("/tickets/:id", auth, async (req, res) => {
  await Ticket.findByIdAndDelete(req.params.id);
  await Tarea.deleteMany({ ticket: req.params.id });
  await Mensaje.deleteMany({ ticket: req.params.id });
  res.json({ ok: true });
});

// ---------- TAREAS ----------
app.get("/tickets/:id/tareas", auth, async (req, res) => {
  res.json((await Tarea.find({ ticket: req.params.id })).sort((a, b) => a.fecha - b.fecha));
});

app.post("/tickets/:id/tareas", auth, async (req, res) => {
  if (!req.body.titulo) return res.status(400).json({ error: "Falta título" });
  res.json(await new Tarea({ ticket: req.params.id, titulo: req.body.titulo }).save());
});

app.patch("/tareas/:id", auth, async (req, res) => {
  res.json(await Tarea.findByIdAndUpdate(req.params.id, { hecha: !!req.body.hecha }, { new: true }));
});

app.delete("/tareas/:id", auth, async (req, res) => {
  await Tarea.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ---------- COMENTARIOS (chat por ticket) ----------
app.get("/tickets/:id/mensajes", auth, async (req, res) => {
  res.json((await Mensaje.find({ ticket: req.params.id })).sort((a, b) => a.fecha - b.fecha));
});

app.post("/tickets/:id/mensajes", auth, async (req, res) => {
  if (!req.body.mensaje) return res.status(400).json({ error: "Mensaje vacío" });
  res.json(await new Mensaje({ ticket: req.params.id, de: req.user, mensaje: req.body.mensaje }).save());
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Servidor corriendo en puerto " + port));
