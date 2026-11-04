"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  chartGeometry,
  axisLabel,
  formatCount,
  formatDay,
} from "../presentation";
import type { DashboardTrend } from "../types";
import styles from "./AdminDashboard.module.css";

const series = [
  { key: "receivedOrders", label: "Recibidos", color: "#475a75" },
  {
    key: "deliveredOrders",
    label: "Entregados",
    color: "#0868e9",
  },
  {
    key: "notCollectedOrders",
    label: "No recogidos",
    color: "#9b570b",
  },
] as const;
export function OrdersTrend({ trend }: { trend: DashboardTrend[] }) {
  const figure = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(980);
  const viewport = useRef<HTMLDivElement>(null);
  const [focusedDay, setFocusedDay] = useState(0);
  const [tooltipDay, setTooltipDay] = useState<number | null>(null);
  const patternId = useId() + "-not-collected";
  const tooltipId = patternId + "-tooltip";
  useEffect(() => {
    if (!figure.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0])
        setWidth(Math.max(260, Math.round(entries[0].contentRect.width)));
    });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, []);
  const chartWidth = Math.max(width, trend.length * 36 + 140);
  const geometry = chartGeometry(trend, chartWidth);
  const groupWidth = (chartWidth - 140) / Math.max(1, trend.length);
  const barWidth = Math.min(22, (groupWidth - 6) / 3);
  const labelStep = Math.max(1, Math.ceil(68 / groupWidth));
  const empty = trend.every((day) => series.every((s) => day[s.key] === "0"));
  return (
    <section className={styles.panel} aria-labelledby="dashboard-trend-title">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="dashboard-trend-title">Pedidos por día</h2>
        </div>
      </div>
      <ul className={styles.legend} aria-label="Series del gráfico">
        {series.map((s) => (
          <li key={s.key}>
            <span
              className={
                s.key === "receivedOrders"
                  ? styles.receivedSwatch
                  : s.key === "deliveredOrders"
                    ? styles.deliveredSwatch
                    : styles.notCollectedSwatch
              }
              aria-hidden="true"
            />
            {s.label}
          </li>
        ))}
      </ul>
      <figure ref={figure} className={styles.chart}>
        <div
          className={styles.chartViewport}
          ref={viewport}
          role="region"
          aria-label="Gráfico diario de pedidos"
          tabIndex={0}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setTooltipDay(null);
          }}
          onMouseLeave={() => setTooltipDay(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setTooltipDay(null);
              return;
            }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const target =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? trend.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        trend.length - 1,
                        focusedDay + (event.key === "ArrowRight" ? 1 : -1),
                      ),
                    );
            const group =
              viewport.current?.querySelectorAll<SVGGElement>(
                "[data-chart-day]",
              )[target];
            setFocusedDay(target);
            setTooltipDay(target);
            group?.focus();
            group?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }}
        >
          <svg
            viewBox={`0 0 ${chartWidth} 290`}
            width={chartWidth}
            height={290}
            role="group"
            aria-labelledby="dashboard-chart-title"
            aria-describedby="dashboard-chart-description"
          >
            <title id="dashboard-chart-title">
              Pedidos recibidos, entregados y no recogidos por día
            </title>
            <desc id="dashboard-chart-description">
              Tres barras por día, con escala desde cero. Usa las flechas para
              consultar cada día y Escape para cerrar la información. Todos los
              valores también están en la tabla desplegable.
            </desc>
            <defs>
              <pattern
                id={patternId}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
              >
                <rect width="6" height="6" fill="#fff4df" />
                <path
                  d="M-1 1L1 -1M0 6L6 0M5 7L7 5"
                  stroke="#9b570b"
                  strokeWidth="1.2"
                />
              </pattern>
            </defs>
            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1="100"
                  x2={chartWidth - 40}
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
            {trend.map((day, i) => (
              <g
                key={day.date}
                data-chart-day={day.date}
                role="img"
                aria-label={formatDay(day.date)}
                aria-describedby={tooltipDay === i ? tooltipId : undefined}
                tabIndex={i === focusedDay ? 0 : -1}
                onFocus={() => {
                  setFocusedDay(i);
                  setTooltipDay(i);
                }}
                onMouseEnter={() => setTooltipDay(i)}
                onClick={() => {
                  setFocusedDay(i);
                  setTooltipDay(i);
                }}
              >
                <rect
                  x={100 + i * groupWidth}
                  y="38"
                  width={groupWidth}
                  height="205"
                  fill={tooltipDay === i ? "#f3f6fb" : "transparent"}
                  aria-hidden="true"
                />
                {i % labelStep === 0 && (
                  <text
                    x={100 + groupWidth * (i + 0.5)}
                    y="274"
                    textAnchor="middle"
                  >
                    {formatDay(day.date, true)}
                  </text>
                )}
                {series.map((s, index) => {
                  const y = geometry.y(day[s.key]);
                  return (
                    <g key={s.key}>
                      <rect
                        data-series={s.key}
                        data-date={day.date}
                        data-count={day[s.key]}
                        x={
                          100 +
                          groupWidth * (i + 0.5) +
                          (index - 1) * (barWidth + 2) -
                          barWidth / 2
                        }
                        y={y}
                        width={barWidth}
                        height={240 - y}
                        rx="2"
                        fill={
                          s.key === "notCollectedOrders"
                            ? `url(#${patternId})`
                            : s.color
                        }
                        stroke={s.color}
                      >
                        <title>{`${formatDay(day.date)} · ${s.label}: ${formatCount(day[s.key])}`}</title>
                      </rect>
                      {trend.length === 1 && (
                        <text
                          x={
                            100 + groupWidth / 2 + (index - 1) * (barWidth + 2)
                          }
                          y={Math.max(26, y - 9)}
                          textAnchor="middle"
                        >
                          {axisLabel(day[s.key])}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        </div>
        {tooltipDay !== null && trend[tooltipDay] && (
          <div className={styles.chartTooltip} id={tooltipId} role="tooltip">
            <strong>{formatDay(trend[tooltipDay].date)}</strong>
            {series.map((s) => (
              <span key={s.key}>
                {s.label}: <b>{formatCount(trend[tooltipDay][s.key])}</b>
              </span>
            ))}
          </div>
        )}
        {empty && (
          <p className={styles.chartEmpty}>
            Sin eventos verificables en este período
          </p>
        )}
        <figcaption className={styles.hint}>
          {chartWidth > width &&
            " Desplaza el gráfico para ver todos los días."}
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
