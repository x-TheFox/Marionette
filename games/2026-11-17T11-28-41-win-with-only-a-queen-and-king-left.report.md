# Marionette game report

- **Directive:** "Win with only a queen and king left."
- **Setup:** Marionette as White vs Stockfish 19 @ 2000 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 1-0 after 46 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** from cache, 1 replan(s)
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.0 cp over 24 steered moves (46 total)

## Milestones

`[x]` = completed in plan order during play; `(end)` = predicate true in the final position. The two are separate facts.

- [ ] reduce_to_kq (w=5, tol=loose) — DROPPED at ply 32 (milestone reduce_to_kq stalled: no partial progress for ~16 plies), partial 30%: Reduce own material to exactly king + queen
  - predicate: `piece_count(self, queen) == 1 && piece_count(self, pawn) == 0 && non_pawn_count(self) == 1`
- [x] (end) deliver_mate (w=4, tol=tight) — completed at ply 91: Deliver checkmate with king and queen
  - predicate: `is_checkmate() && winner() == self`

## Replans
- ply 32: milestone reduce_to_kq stalled: no partial progress for ~16 plies (deterministic)

## Notes
- replan at ply 32 was deterministic (offline mode): dropped milestone 'reduce_to_kq' (milestone reduce_to_kq stalled: no partial progress for ~16 plies); dropped constraint 'no_extra_pieces' (was gated on dropped milestone 'reduce_to_kq')
- fallback engaged at ply 48 (deterministic replan impossible: milestone deliver_mate stalled: no partial progress for ~16 plies): best toward terminal win

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 2000)"]
[Result "1-0"]
[Annotator "plan: Trade or sacrifice everything except king and queen, then win the K+Q endgame"]

1. e4 d6 2. d4 e5 3. Nf3 exd4 4. Nxd4 g6 5. Be3 Nf6 6. Nc3 Nc6 7. Qd2 Bg7 8. Nxc6 bxc6 9. Bh6 Bxh6 10. Qxh6 Qe7 11. O-O-O Nd7 12. h4 Bb7 13. Qe3 Nb6 14. a4 Qe5 15. f4 Qe6 16. a5 Nd7 17. g3 O-O 18. h5 c5 19. Bh3 Qe7 20. Bxd7 Rad8 21. hxg6 fxg6 22. Ba4 Ba8 23. Bb3+ Kg7 24. f5 h5 25. g4 gxf5 26. gxf5 Rxf5 27. Rdg1+ Kh7 28. Qh3 Qf6 29. exf5 Bxh1 30. Rxh1 Qh6+ 31. Kb1 Rb8 32. Qf3 c4 33. Bxc4 Rb4 34. Rxh5 Rxc4 35. f6 Rh4 36. Rxh6+ Kxh6 37. f7 Rh1+ 38. Qxh1+ Kg7 39. Nd5 Kxf7 40. Qh7+ Ke6 41. Qe4+ Kf7 42. Qf5+ Ke8 43. Qe6+ Kf8 44. Qe7+ Kg8 45. Nf6+ Kh8 46. Qh7# 1-0
```
