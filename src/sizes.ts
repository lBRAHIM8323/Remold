// Human-readable file sizes and size changes. No VS Code dependency so tests can use it.

export function formatSize(bytes: number): string {
    if (!Number.isFinite(bytes))
        return 'failed';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "−72%", "+15%" or "same size". */
export function sizeChange(before: number, after: number): string {
    if (!Number.isFinite(after) || before <= 0)
        return '';
    const percent = Math.round((after - before) / before * 100);
    return percent === 0 ? 'same size' : percent < 0 ? `−${-percent}%` : `+${percent}%`;
}
