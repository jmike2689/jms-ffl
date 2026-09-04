import { NextResponse } from 'next/server';

// Prevent Next.js from caching the route memory
export const dynamic = 'force-dynamic';

// 2026 NFL Bye Weeks Map
const NFL_BYE_WEEKS: Record<string, number> = {
    ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 11, CHI: 7, CIN: 6, CLE: 10,
    DAL: 14, DEN: 14, DET: 6, GB: 11, HOU: 14, IND: 14, JAX: 12, KC: 5,
    LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
    NYJ: 13, PHI: 14, PIT: 9, SF: 8, SEA: 11, TB: 10, TEN: 12, WAS: 14,
};

// Known Sleeper API ghosts that occasionally spike in search_rank
const GHOST_PLAYERS = new Set([
    'Todd Gurley', 'Tom Brady', 'Drew Brees', 'Rob Gronkowski',
    'Matt Ryan', 'Philip Rivers', 'Ben Roethlisberger', 'Antonio Brown'
]);

export async function GET() {
    try {
        const res = await fetch('https://api.sleeper.app/v1/players/nfl', {
            cache: 'no-store'
        });

        if (!res.ok) throw new Error(`Sleeper API returned status ${res.status}`);

        const data = await res.json();
        const validPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

        const filteredPlayers = Object.values(data)
            .filter((p: any) => {
                const position = p.fantasy_positions?.[0] || p.position;
                const name = (p.full_name || `${p.first_name} ${p.last_name}`).trim();
                const hasTeam = p.team && p.team !== 'FA';
                const rank = typeof p.search_rank === 'number' ? p.search_rank : 999999;
                const yearsExp = p.years_exp || 0;

                // 1. Must be a valid fantasy position
                if (!validPositions.has(position)) return false;

                // 2. Explicitly ban known ghosts and officially inactive/retired statuses
                if (GHOST_PLAYERS.has(name)) return false;
                if (!p.active || p.status === 'Inactive' || p.status === 'Retired') return false;

                // 3. Strict Free Agent Rule:
                // Ban FAs who have been in the league more than 3 years (e.g., Todd Gurley)
                if (!hasTeam && yearsExp > 3) return false;
                // Ban FAs with weak search ranks
                if (!hasTeam && rank > 100) return false;

                // 4. Global depth chart cull
                if (rank > 1000) return false;

                return true;
            })
            .map((p: any) => {
                const team = p.team || 'FA';
                const position = p.fantasy_positions?.[0] || p.position;
                const name = (p.full_name || `${p.first_name} ${p.last_name}`).trim();

                return {
                    id: p.player_id,
                    name,
                    position,
                    team,
                    adp: typeof p.search_rank === 'number' ? p.search_rank : 9999,
                    injury_status: p.injury_status || null,
                    bye: NFL_BYE_WEEKS[team] || null,
                };
            })
            .sort((a, b) => a.adp - b.adp);

        return NextResponse.json(filteredPlayers);
    } catch (error) {
        console.error('Error fetching Sleeper players:', error);
        return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
    }
}