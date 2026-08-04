export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const authorization = request.headers.authorization;
  if (!authorization) {
    return response.status(401).json({ error: 'Missing WHOOP access token.' });
  }

  try {
    const summary = await readWhoopSummary(authorization);
    return response.status(200).json(summary);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'WHOOP summary request failed.',
    });
  }
}

async function readWhoopSummary(authorization) {
  const end = new Date();
  const start = new Date(end.getTime() - 36 * 60 * 60 * 1000);
  const params = new URLSearchParams({ limit: '10', start: start.toISOString(), end: end.toISOString() });
  const headers = { Authorization: authorization };
  const [profile, cycle, recovery, sleep, workout] = await Promise.all([
    whoopGet('/developer/v2/user/profile/basic', headers),
    whoopGet(`/developer/v2/cycle?${params}`, headers),
    whoopGet(`/developer/v2/recovery?${params}`, headers),
    whoopGet(`/developer/v2/activity/sleep?${params}`, headers),
    whoopGet(`/developer/v2/activity/workout?${params}`, headers),
  ]);

  const cycleRecord = firstRecord(cycle);
  const recoveryRecord = firstRecord(recovery);
  const sleepRecord = firstRecord(sleep);
  const workouts = Array.isArray(workout?.records) ? workout.records : [];

  return {
    profile: profile
      ? {
          firstName: profile.first_name,
          lastName: profile.last_name,
          email: profile.email,
        }
      : null,
    cycle: cycleRecord
      ? {
          strain: cycleRecord.score?.strain ?? null,
          kilojoule: cycleRecord.score?.kilojoule ?? null,
          averageHeartRate: cycleRecord.score?.average_heart_rate ?? null,
          maxHeartRate: cycleRecord.score?.max_heart_rate ?? null,
        }
      : null,
    recovery: recoveryRecord
      ? {
          score: recoveryRecord.score?.recovery_score ?? null,
          hrvRmssdMilli: recoveryRecord.score?.hrv_rmssd_milli ?? null,
          restingHeartRate: recoveryRecord.score?.resting_heart_rate ?? null,
          spo2Percentage: recoveryRecord.score?.spo2_percentage ?? null,
        }
      : null,
    sleep: sleepRecord
      ? {
          performancePercentage: sleepRecord.score?.sleep_performance_percentage ?? null,
          efficiencyPercentage: sleepRecord.score?.sleep_efficiency_percentage ?? null,
          consistencyPercentage: sleepRecord.score?.sleep_consistency_percentage ?? null,
          totalSleepHours: millisToHours(
            (sleepRecord.score?.stage_summary?.total_light_sleep_time_milli ?? 0) +
              (sleepRecord.score?.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) +
              (sleepRecord.score?.stage_summary?.total_rem_sleep_time_milli ?? 0),
          ),
        }
      : null,
    workouts: workouts.map((record) => ({
      sportName: record.sport_name ?? record.sport_id ?? null,
      strain: record.score?.strain ?? null,
      kilojoule: record.score?.kilojoule ?? null,
      averageHeartRate: record.score?.average_heart_rate ?? null,
    })),
  };
}

async function whoopGet(pathname, headers) {
  const upstream = await fetch(`https://api.prod.whoop.com${pathname}`, { headers });
  if (upstream.status === 404) return null;
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    throw new Error(data?.error_description || data?.error || `WHOOP request failed: ${upstream.status}`);
  }
  return data;
}

function firstRecord(value) {
  return Array.isArray(value?.records) ? value.records[0] : value;
}

function millisToHours(value) {
  return Math.round((value / 1000 / 60 / 60) * 10) / 10;
}
