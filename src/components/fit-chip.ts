import { HARDWARE_FIT, type HardwareFit } from "../types";
import { MESSAGES } from "../locales/en";

export function renderFitChip(container: HTMLElement, fit: HardwareFit | null | undefined): void {
    if (fit !== HARDWARE_FIT.FITS && fit !== HARDWARE_FIT.TIGHT && fit !== HARDWARE_FIT.WONT_RUN) return;
    container.createEl("span", { text: fitLabel(fit), cls: `lilbee-fit-chip lilbee-fit-${fit}` });
}

function fitLabel(fit: HardwareFit): string {
    if (fit === HARDWARE_FIT.FITS) return MESSAGES.LABEL_FIT_FITS;
    if (fit === HARDWARE_FIT.TIGHT) return MESSAGES.LABEL_FIT_TIGHT;
    return MESSAGES.LABEL_FIT_WONT_RUN;
}
