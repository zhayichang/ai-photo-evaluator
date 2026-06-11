export function repairUnescapedQuotes(text) {
    let repaired = "";
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (!inString) {
            repaired += char;
            if (char === "\"") inString = true;
            continue;
        }

        if (escaped) {
            repaired += char;
            escaped = false;
            continue;
        }

        if (char === "\\") {
            repaired += char;
            escaped = true;
            continue;
        }

        if (char !== "\"") {
            repaired += char;
            continue;
        }

        let nextIndex = index + 1;
        while (nextIndex < text.length && /\s/.test(text[nextIndex])) nextIndex += 1;
        const nextChar = text[nextIndex];
        const closesJsonString = nextIndex >= text.length || [":", ",", "}", "]"].includes(nextChar);

        if (closesJsonString) {
            repaired += char;
            inString = false;
        } else {
            repaired += "\\\"";
        }
    }

    return repaired;
}

export function parseJsonWithBareQuoteRepair(text) {
    try {
        return { value: JSON.parse(text), repaired: false };
    } catch (originalError) {
        const repairedText = repairUnescapedQuotes(text);
        if (repairedText === text) throw originalError;
        return { value: JSON.parse(repairedText), repaired: true };
    }
}
