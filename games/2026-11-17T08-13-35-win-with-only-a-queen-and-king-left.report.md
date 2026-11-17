# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 1600 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 1-0 after 24 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.2 cp over 23 steered moves (24 total)

## Milestones
- [ ] reduce_to_kq (w=5, tol=loose) — incomplete, partial 40%: Reduce own material to exactly king + queen
  - predicate: `piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1`
- [ ] deliver_mate (w=4, tol=tight) — incomplete, partial 0%: Deliver checkmate with king and queen
  - predicate: `is_checkmate() && winner() == self`

## Notes
- replan failed at ply 46; engaging fallback [kilo: This operation was aborted | llm7: HTTP 429: {"error":{"message":"Daily token quota exceeded. Retry after 9879 seconds.","type":"insufficient_quota","param":null,"code":"quota | nim: This operation was aborted]
- fallback engaged at ply 46 (replan failed: milestone reduce_to_kq stalled: no partial progress for ~16 plies): best toward terminal win

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

1. e4 e5 2. d4 d6 3. Nf3 Nd7 4. Bc4 h6 5. dxe5 dxe5 6. Bxf7+ Kxf7 7. Nxe5+ Ke8 8. Qh5+ g6 9. Qxg6+ Ke7 10. Qf7+ Kd6 11. Nc4+ Kc5 12. b4+ Kxb4 13. a4 a6 14. Bd2+ Kc5 15. Bb4+ Kxb4 16. c3+ Kb3 17. Ne5+ Kc2 18. Ra2+ Kc1 19. Nd3+ Kxb1 20. Rb2+ Ka1 21. e5 Ba3 22. Qb3 Be7 23. h4 Ngf6 24. Qa2# 1-0
```
