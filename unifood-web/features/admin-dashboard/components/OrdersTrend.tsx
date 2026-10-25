"use client";
import { useEffect, useRef, useState } from "react";
import {
  chartGeometry,
  axisLabel,
  formatCount,
  formatDay,
} from "../presentation";
import type { DashboardTrend } from "../types";
import styles from "./AdminDashboard.module.css";

const series = [
  {
    key: "receivedOrders",
    label: "Recibidos",
    color: "#155bb5",
    dash: undefined,
  },
  {
    key: "deliveredOrders",
    label: "Entregados",
    color: "#267056",
    dash: "9 5",
  },
  {
    key: "notCollectedOrders",
    label: "No recogidos",
    color: "#9b570b",
    dash: "2 5",
  },
] as const;
export function OrdersTrend({ trend }: { trend: DashboardTrend[] }) {
  const figure = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(980);
  useEffect(() => {
    if (!figure.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0])
        setWidth(Math.max(260, Math.round(entries[0].contentRect.width)));
    });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, []);
  const geometry = chartGeometry(trend, width);
  const labelIndices = [
    ...new Set([0, Math.floor((trend.length - 1) / 2), trend.length - 1]),
  ].filter((i) => i >= 0);
  return (
    <section className={styles.panel} aria-labelledby="dashboard-trend-title">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="dashboard-trend-title">Evolución diaria de pedidos</h2>
          <p>Recepción, entrega y no recogida según la fecha de cada evento.</p>
        </div>
      </div>
      <ul className={styles.legend} aria-label="Series del gráfico">
        {series.map((s) => (
          <li key={s.key}>
            <svg width="28" height="12" aria-hidden="true">
              <line
                x1="0"
                y1="6"
                x2="28"
                y2="6"
                stroke={s.color}
                strokeWidth="3"
                strokeDasharray={s.dash}
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <figure ref={figure} className={styles.chart}>
        <svg
          viewBox={`0 0 ${width} 290`}
          role="img"
          aria-labelledby="dashboard-chart-title dashboard-chart-description"
        >
          <title id="dashboard-chart-title">
            Pedidos diarios recibidos, entregados y no recogidos
          </title>
          <desc id="dashboard-chart-description">
            Líneas rectas con escala desde cero. Los valores exactos de todos
            los días están en la tabla desplegable debajo del gráfico.
          </desc>
          {geometry.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1="100"
                x2={width - 40}
                y1={geometry.y(tick)}
                y2={geometry.y(tick)}
                stroke="#e3eaf2"
              />
              <text x="88" y={geometry.y(tick) + 4} textAnchor="end">
                <title>{`${formatCount(tick)} pedidos`}</title>
                {axisLabel(tick)}
              </text>
            </g>
          ))}
          {labelIndices.map((i) => (
            <text key={i} x={geometry.x(i)} y="274" textAnchor="middle">
              {formatDay(trend[i].date, true)}
            </text>
          ))}
          {series.map((s, index) => (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeDasharray={s.dash}
                points={trend
                  .map((day, i) => `${geometry.x(i)},${geometry.y(day[s.key])}`)
                  .join(" ")}
              />
              {trend.length === 1 && (
                <circle
                  cx={geometry.x(0)}
                  cy={geometry.y(trend[0][s.key])}
                  r={6 - index * 2}
                  fill={s.color}
                >
                  <title>{`${s.label}: ${formatCount(trend[0][s.key])}`}</title>
                </circle>
              )}
            </g>
          ))}
        </svg>
        <figcaption className={styles.hint}>
          Días de Colombia · Pedidos registrados por evento.
          {geometry.max.toString().length > 9 &&
            " Eje abreviado; consulta los valores exactos en la tabla."}
        </figcaption>
      </figure>
      <details className={styles.dailyDetails}>
        <summary>Ver datos diarios en tabla</summary>
        <div
          className={styles.tableScroll}
          role="region"
          aria-label="Datos diarios de pedidos"
          tabIndex={0}
        >
          <table>
            <caption>Pedidos por día de Colombia</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Recibidos</th>
                <th scope="col">Entregados</th>
                <th scope="col">No recogidos</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{formatDay(day.date)}</th>
                  <td>{formatCount(day.receivedOrders)}</td>
                  <td>{formatCount(day.deliveredOrders)}</td>
                  <td>{formatCount(day.notCollectedOrders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
