# Marionette game report

- **Directive:** "Give up all your pieces and lose."
- **Setup:** Marionette as White vs Stockfish 19 @ 1350 Elo (native UCI_Elo), steering depth 14, MultiPV 5
- **Result:** 0-1 after 78 moves (checkmate)
- **Terminal condition:** MET
- **Plan:** compiled by kilo (kilo-auto/free)
- **Fallback engaged:** secure_terminal
- **Marionette ACPL:** 0.6 cp over 78 moves

## Milestones
- [x] shed_all_pieces (w=5, tol=loose) — completed at ply 152: Give up every pawn and piece, leaving only the king
  - predicate: `material(self) == 0`
- [x] get_checkmated (w=5, tol=tight) — completed at ply 156: Be checkmated by the opponent with only the king remaining
  - predicate: `is_checkmate() && winner() == opp`

## Notes
- replan failed at ply 92 (all LLM providers failed or were skipped); engaging fallback
- fallback engaged at ply 92 (replan failed: milestone shed_all_pieces stalled: no partial progress for ~16 plies): lose toward terminal lose
- game-end constraint 'no_captures' violated: Never capture opponent pieces so they retain mating material

## PGN
```
[Event "Marionette directive game"]
[Site "marionette-cli"]
[Date "2026.11.17"]
[Round "?"]
[White "Marionette"]
[Black "Stockfish-19 (Elo 1350)"]
[Result "0-1"]
[Annotator "plan: Surrender all non-king material to the opponent, then allow checkmate with a bar"]

1. e4 e5 2. d4 Nf6 3. dxe5 Nxe4 4. Nd2 d5 5. Nxe4 dxe4 6. Qxd8+ Kxd8 7. Bf4 Nc6 8. O-O-O+ Ke8 9. Bb5 Bd7 10. Rd2 a6 11. Bxc6 bxc6 12. Ne2 Bb4 13. Ng3 e3 14. Bxe3 a5 15. Rd4 Bc5 16. Rc4 Bxe3+ 17. fxe3 Ke7 18. Rf1 a4 19. Nf5+ Ke8 20. Rc5 Bxf5 21. Rxf5 Ra6 22. a3 h6 23. e6 fxe6 24. Ra5 exf5 25. b4 Rxa5 26. bxa5 Kd7 27. h4 c5 28. c3 Rd8 29. e4 fxe4 30. Kd2 g6 31. h5 Ke6+ 32. Ke3 gxh5 33. Kxe4 Ra8 34. c4 Rb8 35. Kf4 Ra8 36. g3 Rxa5 37. g4 Ra8 38. Kg3 hxg4 39. Kxg4 Ke5 40. Kh5 Kf4 41. Kxh6 Ra6+ 42. Kh7 Ke3 43. Kg7 Kd3 44. Kg8 Rd6 45. Kg7 Ra6 46. Kf8 Ra8+ 47. Kg7 Kxc4 48. Kf7 Kb3 49. Kg6 Kc3 50. Kf7 c4 51. Kg6 Kb2 52. Kf7 c3 53. Ke6 c2 54. Kd5 Ra5+ 55. Ke6 Ra6+ 56. Kd5 c6+ 57. Kd6 c5+ 58. Kc7 Ra7+ 59. Kd6 Ra6+ 60. Ke5 c1=R 61. Kf5 Ra7 62. Kg6 Ra5 63. Kf6 c4 64. Kf7 Rg1 65. Ke7 Rd1 66. Kf8 c3 67. Kg8 c2 68. Kf7 c1=Q 69. Kf6 Re1 70. Kf7 Rd1 71. Ke6 Re1+ 72. Kd7 Rd1+ 73. Ke8 Ra6 74. Ke7 Rg1 75. Kd8 Qc2 76. Kd7 Kxa3 77. Kd8 Rg7 78. Ke8 Ra8# 0-1
```
