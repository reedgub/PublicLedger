"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calibrationBuckets } from "@/lib/scoring";

export function CalibrationChart({ observations }: { observations: Array<{ probability: number; outcome: 0 | 1 }> }) {
  if (observations.length < 10) {
    return <p className="border border-dashed p-8 text-center text-sm text-muted-foreground">Calibration requires at least 10 scoring-eligible predictions with an explicitly stated numeric probability.</p>;
  }
  const data = calibrationBuckets(observations).map((bucket) => ({
    bucket: bucket.label,
    predicted: bucket.predictedAverage === null ? null : Math.round(bucket.predictedAverage * 100),
    observed: bucket.observedRate === null ? null : Math.round(bucket.observedRate * 100),
  }));
  return (
    <div className="h-80 w-full border bg-card p-4" aria-label="Calibration chart: predicted average versus observed result rate">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#cec9bd" />
          <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value) => `${value}%`} contentStyle={{ borderRadius: 0, borderColor: "#11110f", background: "#fbfaf6" }} />
          <Legend />
          <Line type="monotone" name="Predicted average" dataKey="predicted" stroke="#68665e" strokeWidth={2} connectNulls />
          <Line type="monotone" name="Observed result" dataKey="observed" stroke="#11110f" strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
