import { NextResponse } from 'next/server';

// 2026 NFL Bye Weeks Map
const NFL_BYE_WEEKS: Record<string, number> = {
    ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 11, CHI: 7, CIN: 6, CLE: 10,
    DAL: 14, DEN: 14, DET: 6, GB: 11, HOU: 14, IND: 14, JAX: 12, KC: 5,
    LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
    NYJ: 13, PHI: 14, PIT: 9, SF: 8, SEA: 11, TB: 10, TEN: 12, WAS: 14,
};

export async function GET() {
    try {
        const res = await fetch('https://api.sleeper.app/v1/players/nfl', {
            next: { revalidate: 3600 } // Cache for 1 hour
        });

        if (!res.ok) {
            throw new Error(`Sleeper API returned status ${res.status}`);
        }

        const data = await res.json();

        const validPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

        const filteredPlayers = Object.values(data)
            .filter((p: any) => {
                // 1. Must be a recognized fantasy football position
                const pos = p.fantasy_positions?.[0] || p.position;
                if (!validPositions.has(pos)) return false;

                // 2. Filter out retired/inactive players
                if (!p.active) return false;

                // 3. Filter out non-active statuses (PUP/IR are active on rosters, but Inactive/Retired are not)
                if (p.status === 'Inactive' || p.status === 'Retired') return false;

                // 4. Must have an active team or a legitimate fantasy search rank
                if (!p.team && (!p.search_rank || p.search_rank > 1200)) return false;

                // 5. Exclude deep practice squad/out of league players with extreme search ranks
                if (p.search_rank && p.search_rank > 1500) return false;

                return true;
            })
            .map((p: any) => {
                const team = p.team || 'FA';
                const position = p.fantasy_positions?.[0] || p.position;
                const name = p.full_name || `${p.first_name} ${p.last_name}`;

                return {
                    id: p.player_id,
                    name: name.trim(),
                    position,
                    team,
                    adp: typeof p.search_rank === 'number' ? p.search_rank : 9999,
                    injury_status: p.injury_status || null,
                    bye: NFL_BYE_WEEKS[team] || null,
                };
            })
            // Safely sort by Sleeper search rank (ADP)
            .sort((a, b) => a.adp - b.adp);

        return NextResponse.json(filteredPlayers);
    } catch (error) {
        console.error('Error fetching Sleeper players:', error);
        return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
    }
}