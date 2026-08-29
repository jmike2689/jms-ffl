import { NextResponse } from 'next/server';

// 2026 NFL Bye Weeks Schedule
const BYE_WEEKS: Record<string, number> = {
    ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11,
    DAL: 14, DEN: 10, DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5,
    LV: 13, LAC: 7, LAR: 11, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
    NYJ: 13, PHI: 10, PIT: 9, SF: 8, SEA: 11, TB: 10, TEN: 9, WAS: 7,
    JAC: 7 // Sleeper sometimes uses JAC instead of JAX
};

export async function GET() {
    try {
        const response = await fetch('https://api.sleeper.app/v1/players/nfl');
        const data = await response.json();

        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

        const players = Object.values(data)
            // 1. Must be active and in a standard fantasy position
            .filter((p: any) => p.active && validPositions.includes(p.position))
            .map((p: any) => {
                // Give Defenses an artificial search rank (e.g., 250) so they don't get cut
                const isDef = p.position === 'DEF';
                const rank = isDef ? 250 : (p.search_rank || 999999);
                const teamCode = p.team || 'FA';

                return {
                    id: p.player_id,
                    name: isDef ? `${p.first_name} ${p.last_name}` : p.full_name || `${p.first_name} ${p.last_name}`,
                    position: p.position,
                    team: teamCode,
                    injury_status: p.injury_status || null,
                    bye: BYE_WEEKS[teamCode] || null, // Map the bye week here
                    _tempRank: rank
                };
            })
            // 2. Sort by our new combined ranking
            .sort((a, b) => a._tempRank - b._tempRank)
            // 3. Keep only the Top 400
            .slice(0, 400)
            // 4. Clean up the final object for the frontend
            .map((p, index) => ({
                id: p.id,
                name: p.name,
                position: p.position,
                team: p.team,
                adp: index + 1,
                injury_status: p.injury_status,
                bye: p.bye
            }));

        return NextResponse.json(players);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
    }
}