const STRINGS = {
    en: {
        on: ["Claude for Safari’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.",
             "Claude for Safari’s extension is currently on. You can turn it off in Safari Extensions preferences."],
        off: ["Claude for Safari’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.",
              "Claude for Safari’s extension is currently off. You can turn it on in Safari Extensions preferences."],
        unknown: ["You can turn on Claude for Safari’s extension in the Extensions section of Safari Settings.",
                  "You can turn on Claude for Safari’s extension in Safari Extensions preferences."],
        button: ["Quit and Open Safari Settings…", "Quit and Open Safari Extensions Preferences…"]
    },
    ru: {
        on: ["Расширение Claude for Safari сейчас включено. Выключить его можно в разделе «Расширения» настроек Safari.",
             "Расширение Claude for Safari сейчас включено. Выключить его можно в настройках расширений Safari."],
        off: ["Расширение Claude for Safari сейчас выключено. Включить его можно в разделе «Расширения» настроек Safari.",
              "Расширение Claude for Safari сейчас выключено. Включить его можно в настройках расширений Safari."],
        unknown: ["Включить расширение Claude for Safari можно в разделе «Расширения» настроек Safari.",
                  "Включить расширение Claude for Safari можно в настройках расширений Safari."],
        button: ["Закрыть и открыть настройки Safari…", "Закрыть и открыть настройки расширений Safari…"]
    }
};

function strings() {
    const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
    for (const l of langs) {
        const code = String(l).toLowerCase().split("-")[0];
        if (STRINGS[code]) return STRINGS[code];
    }
    return STRINGS.en;
}

function show(enabled, useSettingsInsteadOfPreferences) {
    const s = strings();
    const i = useSettingsInsteadOfPreferences ? 0 : 1;
    document.getElementsByClassName('state-on')[0].innerText = s.on[i];
    document.getElementsByClassName('state-off')[0].innerText = s.off[i];
    document.getElementsByClassName('state-unknown')[0].innerText = s.unknown[i];
    document.getElementsByClassName('open-preferences')[0].innerText = s.button[i];

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
