export type ScheduledTask = {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
};

export type SchedulerHandle = { stop: () => void };

export function startScheduler(tasks: readonly ScheduledTask[]): SchedulerHandle {
  const timers = tasks.map((task) => {
    let running = false;

    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await task.run();
      } catch (error) {
        console.error(`Scheduled task "${task.name}" failed:`, error);
      } finally {
        running = false;
      }
    };

    const timer = setInterval(() => void tick(), task.everyMs);
    timer.unref();
    return timer;
  });

  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
