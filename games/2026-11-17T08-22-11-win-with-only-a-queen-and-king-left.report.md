# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 1100 Elo (emulated below native floor), steering depth 14, MultiPV 5
- **Result:** 1-0 after 58 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.1 cp over 31 steered moves (58 total)

## Milestones
- [ ] reduce_to_kq (w=5, tol=loose) — incomplete, partial 60%: Reduce own material to exactly king + queen
  - predicate: `piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1`
- [ ] deliver_mate (w=4, tol=tight) — incomplete, partial 0%: Deliver checkmate with king and queen
  - predicate: `is_checkmate() && winner() == self`

## Notes
- opponent Elo 1100 is below the native UCI_Elo floor (1320): emulated with Skill Level 6, depth cap 10, eval-weighted move choice
- replan failed at ply 62; engaging fallback [kilo: empty content (finish=length) | kilo: empty content (finish=length) | kilo: empty content (finish=length) | llm7: HTTP 429: {"error":{"message":"Daily token quota exceeded. Retry after 2115 seconds.","type":"insufficient_quota","param":null,"code":"quota | nim: This operation was aborted]
- fallback engaged at ply 62 (replan failed: milestone reduce_to_kq stalled: no partial progress for ~16 plies): best toward terminal win

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 1100)"]
[Result "1-0"]
[Annotator "plan: Trade or sacrifice everything except king and queen, then win the K+Q endgame"]

1. e4 e6 2. d4 d5 3. exd5 exd5 4. Nf3 Nf6 5. Bd3 Be7 6. h3 O-O 7. O-O Nc6 8. a3 h6 9. Re1 Re8 10. Nc3 Bd6 11. Rxe8+ Qxe8 12. Nb5 Qd8 13. c3 Be7 14. Bf4 Ne8 15. c4 Bd6 16. Bd2 Be6 17. cxd5 Bxd5 18. Nxd6 cxd6 19. Be3 Qd7 20. Nd2 Ne7 21. Ne4 Nf5 22. Bf4 Rc8 23. Qd2 Nxd4 24. Re1 Qc6 25. Bb1 Nb3 26. Qe3 Nc5 27. Ng3 Qd7 28. Bxh6 Qe6 29. Nf5 Rc7 30. Bxg7 Nxg7 31. Qc3 Nxf5 32. Bxf5 Ne4 33. Qxc7 Qxf5 34. f3 Ng5 35. Qxd6 f6 36. Re7 Nf7 37. Qd7 Qb1+ 38. Kh2 Qa2 39. Re8+ Kg7 40. Qg4+ Ng5 41. h4 Bc6 42. Re3 Qf7 43. hxg5 Be8 44. gxf6+ Kxf6 45. Qh4+ Kg7 46. Re7 a6 47. Rxf7+ Kxf7 48. Qd8 Bc6 49. Kg3 Bb5 50. Kf2 Kg7 51. Qe7+ Kg6 52. g4 b6 53. f4 Ba4 54. f5+ Kh6 55. Qf6+ Kh7 56. Qg6+ Kh8 57. f6 Bb5 58. Qg7# 1-0
```
