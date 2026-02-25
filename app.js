// ============================================================
// Code Blue Tracker — Main Application
// ============================================================

(function () {
  "use strict";

  // ---- State ----
  let codeRunning = false;
  let codeStartTime = null;       // Date object
  let masterSeconds = 0;
  let masterIntervalId = null;

  let compressionSeconds = 120;   // counts DOWN from 2:00
  let epiSeconds = 240;           // counts DOWN from 4:00
  let compressionAlertActive = false;
  let epiAlertActive = false;

  const eventLog = [];            // { wallTime, elapsed, category, text }
  const undoStack = [];           // stores removed entries for potential re-add (not used, just pops)

  // ---- DOM References ----
  const $masterTimer        = document.getElementById("master-timer");
  const $btnStartCode       = document.getElementById("btn-start-code");
  const $btnEndCode         = document.getElementById("btn-end-code");
  const $subTimers          = document.getElementById("sub-timers");
  const $compressionTimer   = document.getElementById("compression-timer");
  const $epiTimer           = document.getElementById("epi-timer");
  const $alertCompression   = document.getElementById("alert-compression");
  const $alertEpi           = document.getElementById("alert-epi");
  const $tabNav             = document.getElementById("tab-nav");
  const $tabContent         = document.getElementById("tab-content");
  const $initialRhythmDisp  = document.getElementById("initial-rhythm-display");
  const $eventLog           = document.getElementById("event-log");

  // ---- Helpers ----
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatMMSS(totalSec) {
    const m = Math.floor(Math.abs(totalSec) / 60);
    const s = Math.abs(totalSec) % 60;
    return pad2(m) + ":" + pad2(s);
  }

  function wallTimeString() {
    const d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function elapsedString() {
    return formatMMSS(masterSeconds);
  }

  function showToast(msg) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  // ---- Audio Alerts (Web Audio API — no external files needed) ----
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function playAlertSound(type) {
    try {
      var ctx = getAudioCtx();
      // Resume context if suspended (mobile browsers require user gesture)
      if (ctx.state === "suspended") ctx.resume();

      if (type === "compression") {
        // 3 rapid beeps — high pitch
        [0, 0.18, 0.36].forEach(function (delay) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "square";
          osc.frequency.value = 880;
          gain.gain.value = 0.3;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.12);
        });
      } else if (type === "epi") {
        // 2 longer tones — lower pitch
        [0, 0.4].forEach(function (delay) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 600;
          gain.gain.value = 0.35;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.3);
        });
      }
    } catch (e) {
      // Audio not available — alerts still flash visually
    }
  }

  // ---- Event Log ----
  function addLogEntry(category, text) {
    const entry = {
      wallTime: wallTimeString(),
      elapsed: elapsedString(),
      category: category,
      text: text
    };
    eventLog.push(entry);
    renderLog();
    return entry;
  }

  function renderLog() {
    const catClass = {
      "Event": "cat-event",
      "Rhythm": "cat-rhythm",
      "Intervention": "cat-intervention",
      "Med": "cat-med",
      "Outcome": "cat-outcome",
      "Alert": "cat-alert"
    };

    // Render newest-first
    $eventLog.innerHTML = eventLog.slice().reverse().map(e =>
      `<div class="log-entry">
        <span class="log-time">${e.wallTime}</span>
        <span class="log-category ${catClass[e.category] || "cat-event"}">${e.category}</span>
        ${e.text}
        <span style="color: var(--text-muted); font-size:0.7rem; margin-left:0.3rem;">[+${e.elapsed}]</span>
      </div>`
    ).join("");

    // Update undo button state
    var undoBtn = document.getElementById("btn-undo");
    if (undoBtn) {
      // Allow undo as long as there are entries (but not the initial "Code Blue called" event)
      undoBtn.disabled = eventLog.length <= 1;
    }
  }

  // ---- Undo Last Entry ----
  window.undoLastEntry = function () {
    if (eventLog.length <= 1) return; // never undo the "Code Blue called" event
    var removed = eventLog.pop();
    renderLog();
    showToast("Undone: " + removed.text);
  };

  // ---- Timer Tick ----
  function tick() {
    masterSeconds++;
    $masterTimer.textContent = formatMMSS(masterSeconds);

    // Compression countdown
    if (compressionSeconds > 0) {
      compressionSeconds--;
    }
    $compressionTimer.textContent = formatMMSS(compressionSeconds);
    updateSubTimerStyle($compressionTimer, compressionSeconds, 120);

    if (compressionSeconds === 0 && !compressionAlertActive) {
      compressionAlertActive = true;
      $alertCompression.classList.remove("hidden");
      $alertCompression.classList.add("flashing");
      playAlertSound("compression");
      addLogEntry("Alert", "Compression switch due");
    }

    // Epi countdown
    if (epiSeconds > 0) {
      epiSeconds--;
    }
    $epiTimer.textContent = formatMMSS(epiSeconds);
    updateSubTimerStyle($epiTimer, epiSeconds, 240);

    if (epiSeconds === 0 && !epiAlertActive) {
      epiAlertActive = true;
      $alertEpi.classList.remove("hidden");
      $alertEpi.classList.add("flashing");
      playAlertSound("epi");
      addLogEntry("Alert", "Epinephrine due");
    }
  }

  function updateSubTimerStyle(el, remaining, total) {
    el.classList.remove("warning", "critical");
    if (remaining === 0) {
      el.classList.add("critical");
    } else if (remaining <= total * 0.25) {
      el.classList.add("warning");
    }
  }

  // ---- Start / End Code ----
  $btnStartCode.addEventListener("click", function () {
    if (codeRunning) return;
    codeRunning = true;
    codeStartTime = new Date();
    masterSeconds = 0;

    addLogEntry("Event", "Code Blue called at " + wallTimeString());

    $btnStartCode.classList.add("hidden");
    $btnEndCode.classList.remove("hidden");
    $subTimers.classList.remove("hidden");
    $tabNav.classList.remove("hidden");
    $tabContent.classList.remove("hidden");

    masterIntervalId = setInterval(tick, 1000);
  });

  // ---- End Code → Outcome Overlay ----
  let endCodeWallTime = null;
  let endCodeElapsed = null;
  let selectedOutcomeType = null;

  const $outcomeOverlay    = document.getElementById("outcome-overlay");
  const $outcomeTimeDisp   = document.getElementById("outcome-time-display");
  const $btnConfirmOutcome = document.getElementById("btn-confirm-outcome");

  $btnEndCode.addEventListener("click", function () {
    if (!codeRunning) return;

    // Stop the timer immediately and capture the time
    codeRunning = false;
    clearInterval(masterIntervalId);
    endCodeWallTime = wallTimeString();
    endCodeElapsed = elapsedString();

    dismissCompressionAlert();
    dismissEpiAlert();

    // Show outcome overlay
    selectedOutcomeType = null;
    $btnConfirmOutcome.disabled = true;
    $outcomeOverlay.querySelectorAll(".btn-rosc, .btn-terminate").forEach(function (b) {
      b.classList.remove("selected-outcome");
    });
    document.getElementById("outcome-notes").value = "";
    $outcomeTimeDisp.textContent = "Stopped at " + endCodeWallTime + " — Duration: " + endCodeElapsed;
    $outcomeOverlay.classList.remove("hidden");
  });

  window.selectOutcome = function (type) {
    selectedOutcomeType = type;
    $btnConfirmOutcome.disabled = false;
    $outcomeOverlay.querySelectorAll(".btn-rosc, .btn-terminate").forEach(function (b) {
      b.classList.remove("selected-outcome");
    });
    if (type === "ROSC") {
      $outcomeOverlay.querySelector(".btn-rosc").classList.add("selected-outcome");
    } else {
      $outcomeOverlay.querySelector(".btn-terminate").classList.add("selected-outcome");
    }
  };

  window.confirmOutcome = function () {
    if (!selectedOutcomeType) return;

    // Log with the captured end-code timestamp
    var outcomeText;
    if (selectedOutcomeType === "ROSC") {
      outcomeText = "ROSC achieved at " + endCodeWallTime;
    } else {
      outcomeText = "Code terminated at " + endCodeWallTime;
    }

    // Use the captured time for the log entry
    var entry = {
      wallTime: endCodeWallTime,
      elapsed: endCodeElapsed,
      category: "Outcome",
      text: outcomeText
    };
    eventLog.push(entry);

    // Also log the code-ended event at that same timestamp
    eventLog.push({
      wallTime: endCodeWallTime,
      elapsed: endCodeElapsed,
      category: "Event",
      text: "Code ended at " + endCodeWallTime + " — Total duration: " + endCodeElapsed
    });

    // Log notes if present
    var notes = document.getElementById("outcome-notes").value.trim();
    if (notes) {
      eventLog.push({
        wallTime: endCodeWallTime,
        elapsed: endCodeElapsed,
        category: "Outcome",
        text: "Notes: " + notes
      });
    }

    renderLog();

    // Hide overlay, hide End Code button
    $outcomeOverlay.classList.add("hidden");
    $btnEndCode.classList.add("hidden");

    showToast(selectedOutcomeType + " logged — code ended");
  };

  // ---- Alert Dismiss ----
  window.dismissCompressionAlert = function () {
    compressionAlertActive = false;
    $alertCompression.classList.add("hidden");
    $alertCompression.classList.remove("flashing");
  };

  window.dismissEpiAlert = function () {
    epiAlertActive = false;
    $alertEpi.classList.add("hidden");
    $alertEpi.classList.remove("flashing");
  };

  // ---- Timer Resets ----
  window.resetCompressionTimer = function () {
    compressionSeconds = 120;
    compressionAlertActive = false;
    $alertCompression.classList.add("hidden");
    $alertCompression.classList.remove("flashing");
    $compressionTimer.textContent = "02:00";
    $compressionTimer.classList.remove("warning", "critical");
    addLogEntry("Event", "Compressor switched — timer reset");
    showToast("Compression timer reset");
  };

  window.resetEpiTimer = function () {
    epiSeconds = 240;
    epiAlertActive = false;
    $alertEpi.classList.add("hidden");
    $alertEpi.classList.remove("flashing");
    $epiTimer.textContent = "04:00";
    $epiTimer.classList.remove("warning", "critical");
    addLogEntry("Event", "Epinephrine timer reset");
    showToast("Epi timer reset");
  };

  // ---- Tab Navigation ----
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ---- Events: Initial Rhythm ----
  window.setInitialRhythm = function (rhythm) {
    if (rhythm === "Other") {
      rhythm = prompt("Enter rhythm:") || "Other";
    }
    $initialRhythmDisp.textContent = "Initial rhythm: " + rhythm;
    $initialRhythmDisp.classList.remove("hidden");
    addLogEntry("Rhythm", "Initial rhythm: " + rhythm);
    showToast("Initial rhythm logged");
  };

  // ---- Events: Pulse Check ----
  window.logPulseCheck = function (rhythm) {
    if (rhythm === "Other") {
      rhythm = prompt("Enter rhythm:") || "Other";
    }
    const pulsePresent = document.getElementById("pulse-present").checked;
    const pulseText = pulsePresent ? "pulse PRESENT" : "no pulse";
    addLogEntry("Rhythm", "Pulse check — " + rhythm + " — " + pulseText);
    showToast("Pulse check logged");
  };

  // ---- Interventions ----
  window.logIntervention = function (name) {
    addLogEntry("Intervention", name);
    showToast(name + " logged");
  };

  window.logCustomIntervention = function () {
    const input = document.getElementById("other-intervention");
    const text = input.value.trim();
    if (!text) return;
    addLogEntry("Intervention", text);
    input.value = "";
    showToast("Intervention logged");
  };

  window.logDefib = function () {
    const input = document.getElementById("defib-energy");
    const joules = input.value.trim();
    if (!joules) {
      addLogEntry("Intervention", "Defibrillation");
    } else {
      addLogEntry("Intervention", "Defibrillation at " + joules + " J");
    }
    input.value = "";
    showToast("Shock logged");
  };

  // ---- Medications ----
  window.logQuickMed = function (name, dose, route) {
    addLogEntry("Med", name + " " + dose + " " + route);
    showToast(name + " logged");

    // Auto-reset epi timer when epinephrine is given
    if (name.toLowerCase().includes("epinephrine")) {
      epiSeconds = 240;
      epiAlertActive = false;
      $alertEpi.classList.add("hidden");
      $alertEpi.classList.remove("flashing");
      $epiTimer.textContent = "04:00";
      $epiTimer.classList.remove("warning", "critical");
    }
  };

  window.logCustomMed = function () {
    const name = document.getElementById("med-name").value.trim();
    const dose = document.getElementById("med-dose").value.trim();
    const route = document.getElementById("med-route").value;
    if (!name) {
      showToast("Enter a drug name");
      return;
    }
    const parts = [name];
    if (dose) parts.push(dose);
    parts.push(route);
    addLogEntry("Med", parts.join(" "));

    document.getElementById("med-name").value = "";
    document.getElementById("med-dose").value = "";
    showToast(name + " logged");

    if (name.toLowerCase().includes("epinephrine")) {
      epiSeconds = 240;
      epiAlertActive = false;
      $alertEpi.classList.add("hidden");
      $alertEpi.classList.remove("flashing");
      $epiTimer.textContent = "04:00";
      $epiTimer.classList.remove("warning", "critical");
    }
  };


  // ---- Copy / Download Log ----
  window.copyLog = function () {
    const text = buildPlainTextLog();
    navigator.clipboard.writeText(text).then(function () {
      showToast("Log copied to clipboard");
    }).catch(function () {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Log copied");
    });
  };

  window.downloadLog = function () {
    const text = buildPlainTextLog();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = "code-blue-log-" + dateStr + ".txt";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Download started");
  };

  function buildPlainTextLog() {
    const lines = [
      "CODE BLUE EVENT LOG",
      "Generated: " + new Date().toLocaleString(),
      "===============================================",
      ""
    ];
    eventLog.forEach(function (e) {
      lines.push("[" + e.wallTime + "] [+" + e.elapsed + "] [" + e.category + "] " + e.text);
    });
    lines.push("");
    lines.push("===============================================");
    lines.push("END OF LOG");
    return lines.join("\n");
  }

})();
