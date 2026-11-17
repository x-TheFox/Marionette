# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 1600 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 1-0 after 29 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.4 cp over 11 steered moves (29 total)

## Milestones
- [ ] reduce_to_kq (w=5, tol=loose) — incomplete, partial 40%: Reduce own material to exactly king + queen
  - predicate: `piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1`
- [ ] deliver_mate (w=4, tol=tight) — incomplete, partial 0%: Deliver checkmate with king and queen
  - predicate: `is_checkmate() && winner() == self`

## Notes
- replan failed at ply 22 (all LLM providers failed or were skipped); engaging fallback
- fallback engaged at ply 22 (replan failed: milestone reduce_to_kq stalled: no partial progress for ~16 plies): best toward terminal win

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 1600)"]
[Result "1-0"]
[Annotator "plan: Trade or sacrifice everything except king and queen, then win the K+Q endgame"]

1. e4 c5 2. d4 d5 3. exd5 Qxd5 4. dxc5 Qe5+ 5. Qe2 Qxc5 6. Nc3 Bd7 7. Bf4 a6 8. Ne4 Qa5+ 9. Qd2 Qf5 10. Bd3 Qh5 11. Nf3 Nc6 12. O-O-O Qd5 13. Nc3 Qa5 14. Bxa6 Nf6 15. Bxb7 Nb4 16. Bxa8 g5 17. Be5 g4 18. Bxf6 Qa7 19. Bxh8 Bg7 20. Bxg7 f6 21. a3 g3 22. fxg3 Qxa8 23. Qxd7+ Kf7 24. Ne5+ fxe5 25. Rhf1+ Qf3 26. Rxf3+ Kxg7 27. Qxe7+ Kg6 28. Rd6+ Kh5 29. Qh4# 1-0
```
