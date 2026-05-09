import { describe, it, expect } from "vitest";
import { computeFit } from "../../src/utils/hardware-fit";
import { HARDWARE_FIT } from "../../src/types";

describe("computeFit", () => {
    it("reports FITS when headroom is at least 1 GB", () => {
        expect(computeFit(4, 6)).toBe(HARDWARE_FIT.FITS);
    });

    it("reports FITS at exactly 1 GB headroom", () => {
        expect(computeFit(4, 5)).toBe(HARDWARE_FIT.FITS);
    });

    it("reports TIGHT when headroom is between 0 and 1 GB", () => {
        expect(computeFit(4, 4.5)).toBe(HARDWARE_FIT.TIGHT);
    });

    it("reports TIGHT at exactly 0 GB headroom", () => {
        expect(computeFit(4, 4)).toBe(HARDWARE_FIT.TIGHT);
    });

    it("reports WONT_RUN when footprint exceeds available memory", () => {
        expect(computeFit(8, 4)).toBe(HARDWARE_FIT.WONT_RUN);
    });
});
