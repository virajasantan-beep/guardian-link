document.addEventListener("DOMContentLoaded", () => {
  const typewriter = document.getElementById("typewriterText");
  if (typewriter) {
    const words = ["safe monitoring", "smart alerts", "parent protection", "evidence tracking"];
    let wordIndex = 0;
    let charIndex = 0;
    let deleting = false;

    const tick = () => {
      const current = words[wordIndex];
      if (!deleting) {
        charIndex++;
        typewriter.textContent = current.slice(0, charIndex);
        if (charIndex === current.length) {
          deleting = true;
          setTimeout(tick, 1000);
          return;
        }
      } else {
        charIndex--;
        typewriter.textContent = current.slice(0, charIndex);
        if (charIndex === 0) {
          deleting = false;
          wordIndex = (wordIndex + 1) % words.length;
        }
      }
      setTimeout(tick, deleting ? 80 : 120);
    };

    tick();
  }

  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied';
        setTimeout(() => btn.innerHTML = original, 1200);
      } catch (e) {
        alert("Copy failed");
      }
    });
  });
});