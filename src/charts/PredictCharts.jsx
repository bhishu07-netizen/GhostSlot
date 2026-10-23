// Charts for the Predict tab. Kept in their own file so the chart library
// only downloads when someone opens Predict.
import React from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell } from "recharts";

export function ForecastChart({ data }) {
  return (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
                <defs><linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C4B5FD" stopOpacity={0.6} /><stop offset="100%" stopColor="#C4B5FD" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="rgba(196,181,253,0.05)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: "#857DA8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#857DA8", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: "#07060C", border: "1px solid rgba(196,181,253,0.1)", borderRadius: 10, fontSize: 12 }} />
                <Area type="monotone" dataKey="risk" stroke="#C4B5FD" strokeWidth={2} fill="url(#riskFill)" />
              </AreaChart>
            </ResponsiveContainer>
  );
}

export function UnderusedChart({ data }) {
  return (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} layout="vertical" margin={{ left: 6, right: 16 }}>
                  <XAxis type="number" hide domain={[0, 100]} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#CFC7EC", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip contentStyle={{ background: "#07060C", border: "1px solid rgba(196,181,253,0.1)", borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="util" radius={[0, 6, 6, 0]} barSize={16}>{data.map((_, i) => <Cell key={i} fill="#E9E3FF" />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
  );
}
