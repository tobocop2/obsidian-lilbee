import { HARDWARE_FIT, type HardwareFit } from "../types";

const HEADROOM_FITS_GB = 1;

export function computeFit(footprintGb: number, availableGb: number): HardwareFit {
    const headroom = availableGb - footprintGb;
    if (headroom < 0) return HARDWARE_FIT.WONT_RUN;
    if (headroom < HEADROOM_FITS_GB) return HARDWARE_FIT.TIGHT;
    return HARDWARE_FIT.FITS;
}
