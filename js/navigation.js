
// ---- NAV ----
window.cambiarPantalla = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
};
window.irHome = () => { render(); cambiarPantalla("home"); };
