import { Component, computed, input } from "@angular/core";

@Component({
  selector: "app-level-gauge",
  templateUrl: "./level-gauge.component.html",
  styleUrl: "./level-gauge.component.css",
})
export class LevelGaugeComponent {
  readonly value = input.required<number>();
  readonly minimum = input.required<number>();
  readonly maximum = input.required<number>();
  readonly scaleMaximum = input.required<number>();
  readonly unit = input("");
  readonly label = input("Уровень измерения");
  readonly kind = input<"level" | "flicker">("level");
  readonly logarithmic = input(false);
  readonly active = input(true);

  readonly markerPosition = computed(() => this.normalize(this.value()) * 100);
  readonly gradient = computed(() => {
    if (this.kind() === "flicker") {
      const limit = this.normalize(this.maximum()) * 100;
      return `linear-gradient(90deg, #35b96b 0%, #a9ce55 ${limit * 0.55}%, #e3c84f ${limit * 0.8}%, #e68b4d ${limit}%, #ed5c4d 100%)`;
    }
    const start = this.normalize(this.minimum()) * 100;
    const end = this.normalize(this.maximum()) * 100;
    const before = Math.max(0, start - 12);
    const after = Math.min(100, end + 12);
    return `linear-gradient(90deg, #ed5c4d 0%, #e3b74f ${before}%, #78c85e ${start}%, #3ba963 ${end}%, #e3b74f ${after}%, #ed5c4d 100%)`;
  });

  private normalize(value: number): number {
    const scaleMaximum = Math.max(1, this.scaleMaximum());
    const clamped = Math.min(scaleMaximum, Math.max(0, Number.isFinite(value) ? value : 0));
    if (!this.logarithmic()) return clamped / scaleMaximum;
    return Math.log10(clamped + 1) / Math.log10(scaleMaximum + 1);
  }
}
