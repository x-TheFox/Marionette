# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 1350 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 1-0 after 24 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.2 cp over 13 steered moves (24 total)

## Milestones
- [ ] reduce_to_kq (w=5, tol=loose) — incomplete, partial 30%: Reduce own material to exactly king + queen
  - predicate: `piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1`
- [ ] deliver_mate (w=4, tol=tight) — incomplete, partial 0%: Deliver checkmate with king and queen
  - predicate: `is_checkmate() && winner() == self`

## Notes
- replan failed at ply 26 (all LLM providers failed or were skipped); engaging fallback
- fallback engaged at ply 26 (replan failed: milestone reduce_to_kq stalled: no partial progress for ~16 plies): best toward terminal win

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 1350)"]
[Result "1-0"]
[Annotator "plan: Trade or sacrifice everything except king and queen, then win the K+Q endgame"]

1. e4 d6 2. d4 e5 3. Nf3 Nf6 4. dxe5 dxe5 5. Qxd8+ Kxd8 6. Nxe5 Be6 7. Nc3 Bc5 8. Nd3 Bf8 9. Be3 Ng4 10. Bf4 f6 11. O-O-O Kc8 12. h3 g5 13. Bxc7 Ne3 14. fxe3 Nd7 15. Bh2 b6 16. Be2 Be7 17. Nd5 b5 18. Nxe7+ Kb7 19. e5 f5 20. Bf3+ Kb6 21. Nb4 Rae8 22. Rd6+ Kc5 23. Na6+ Kc4 24. Be2# 1-0
```
