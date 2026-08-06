import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const response = await fetch('https://api.sleeper.app/v1/players/nfl');
        const data = await response.json();

        const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

        const players = Object.values(data)
            // 1. Must be active and in a standard fantasy position
            .filter((p: any) => p.active && validPositions.includes(p.position))
            .map((p: any) => {
                // FIX: Give Defenses an artificial search rank (e.g., 250) so they don't get cut
                const isDef = p.position === 'DEF';
                const rank = isDef ? 250 : (p.search_rank || 999999);

                return {
                    id: p.player_id,
                    name: isDef ? `${p.first_name} ${p.last_name}` : p.full_name || `${p.first_name} ${p.last_name}`,
                    position: p.position,
                    team: p.team || 'FA',
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
                adp: index + 1
            }));

        return NextResponse.json(players);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
    }
}