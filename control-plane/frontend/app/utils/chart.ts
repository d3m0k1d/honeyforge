import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

Chart.defaults.font.size = 11;
if (Chart.defaults.animation !== false) {
  Chart.defaults.animation.duration = 400;
}

export { Chart };
export type { ChartType, ChartData, ChartOptions } from "chart.js";
