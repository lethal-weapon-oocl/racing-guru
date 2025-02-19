import {Component, OnInit} from '@angular/core';

import {WebsocketService} from '../model/websocket.service';
import {PastStarter, Starter} from '../model/starter.model';
import {Racecard} from '../model/racecard.model';
import {WinPlaceOdds} from '../model/order.model';
import {JOCKEYS, TRAINERS} from '../model/person.model';
import {ONE_MILLION, PAYOUT_RATE} from '../constants/numbers';
import {BOUNDARY_JOCKEYS} from "../constants/persons";
import {RestRepository} from '../model/rest.repository';
import {CollaborationStarter} from '../model/collaboration.model';

@Component({
  selector: 'app-racecard',
  templateUrl: './racecard.component.html'
})
export class RacecardComponent implements OnInit {
  racecards: Racecard[] = [];
  remainingTime: string = '---';

  activeTrainer: string = '';
  activeDraw: number = 0;
  activeRace: number = 1;

  hoveredJockey: string = '';

  constructor(
    private socket: WebsocketService,
    private repo: RestRepository
  ) {
    socket.racecards.subscribe(data => {
      if (this.racecards.length !== data.length) this.racecards = data;
      else {
        this.racecards.forEach(r => {
          const newCard = data.filter(d => d.race === r.race).pop();
          if (newCard && newCard !== r) {
            if (newCard.time !== r.time) r.time = newCard.time;
            if (newCard.starters !== r.starters) r.starters = newCard.starters;
            if (newCard.pool !== r.pool) r.pool = newCard.pool;
            if (newCard.odds !== r.odds) r.odds = newCard.odds;
            if (newCard.dividend !== r.dividend) r.dividend = newCard.dividend;
            if (newCard.favorites !== r.favorites) r.favorites = newCard.favorites;
          }
        })
      }

      this.racecards.sort((r1, r2) => r1.race - r2.race);
    });
  }

  ngOnInit(): void {
    setInterval(() => this.socket.racecards.next([]), 3_000);
    setInterval(() => this.updateRemainingTime(), 5_000);
    this.repo.fetchPastStarters();
    this.repo.fetchCollaborations();
  }

  updateRemainingTime = () => {
    if (!this.next) {
      this.remainingTime = `---`;
      return
    }

    const raceTime = new Date(this.next.time).getTime();
    const currTime = new Date().getTime();
    const diff = Math.floor((raceTime - currTime) / 1000);
    if (diff <= 999) this.remainingTime = `${diff} sec`
    else if (diff <= 7200) this.remainingTime = `${Math.floor(diff / 60)} min`
    else this.remainingTime = `${Math.floor(diff / 3600)} hrs`
  }

  setHoveredJockey = (hovered: string) =>
    this.hoveredJockey = hovered;

  setActiveTrainer = (clicked: string) =>
    this.activeTrainer = this.activeTrainer === clicked ? '' : clicked

  setActiveDraw = (clicked: number) =>
    this.activeDraw = this.activeDraw === clicked ? 0 : clicked

  setActiveRace = (clicked: number) =>
    this.activeRace = clicked

  getPastHorseStarters(current: Starter): PastStarter[] {
    return this.repo.findPastStarters()
      .filter(s => s.horse === current.horse)
      .slice(0, 16);
  }

  getPastCollaborationStarters(current: Starter): CollaborationStarter[] {
    return (
      this.repo.findCollaborations()
        .filter(c => c.jockey === current.jockey && c.trainer === current.trainer)
        .pop()
        ?.starters || []
    )
      .filter(s => {
        if (s.meeting !== this.currentMeeting) return true;
        return s.meeting === this.currentMeeting && s.race < this.activeRace;
      })
      .sort((r1, r2) =>
        r2.meeting.localeCompare(r1.meeting) || r2.race - r1.race
      )
      .slice(0, 28);
  }

  getRaceBadgeStyle(race: number): string {
    return this.activeRace === race
      ? `text-yellow-400 border-yellow-400`
      : `border-gray-600 hover:border-yellow-400 hvr-float-shadow cursor-pointer`;
  }

  isHighlightEarning(jockey: string): boolean {
    return this.getMeetingEarning(jockey) >= 12;
  }

  getMeetingEarning(jockey: string): number {
    return parseFloat(
      this.racecards
        .filter(r => this.getPlacing(jockey, r) > 0)
        .map(r => this.getRaceEarning(jockey, r))
        .reduce((prev, curr) => prev + curr, 0)
        .toFixed(1)
    );
  }

  getRaceEarning(jockey: string, racecard: Racecard): number {
    const placing = this.getPlacing(jockey, racecard);
    const odds = this.getWinPlaceOdds(jockey, racecard);
    const order = odds.order;

    if ([1, 2, 3].includes(placing)) {
      const win = racecard.dividend?.win?.filter(w => w.order === order).pop();
      const pla = racecard.dividend?.place?.filter(p => p.order === order).pop();
      if (placing === 1) return win?.odds || 0;
      if (placing === 2) return (pla?.odds || 0) + (odds.win / 10);
      return pla?.odds || (odds.win / 10);
    }

    return placing === 4 ? odds.win / 10 : 0;
  }

  getPlacing(jockey: string, racecard: Racecard): number {
    const tierce = racecard?.dividend?.tierce;
    const quartet = racecard?.dividend?.quartet;
    if (!tierce) return 0;

    let orders = tierce[0].orders;
    if (quartet) orders = quartet[0].orders;

    const order = this.getStarter(jockey, racecard)?.order;
    if (!orders.includes(order)) return 0;
    return orders.indexOf(order) + 1;
  }

  getPlacingColor(jockey: string, racecard: Racecard): string {
    const placing = this.getPlacing(jockey, racecard);
    const colors = [
      'text-red-600', 'text-green-600',
      'text-blue-600', 'text-purple-600',
    ];
    return placing > 0 ? colors[placing - 1] : '';
  }

  getPlacingBorderBackground(jockey: string, racecard: Racecard): string {
    return [
      'border border-gray-700',
      'bg-red-800', 'bg-green-800',
      'bg-blue-800', 'bg-purple-800',
    ][this.getPlacing(jockey, racecard)];
  }

  isComingFavoured(jockey: string, racecard: Racecard): boolean {
    if (racecard.race < this.nextRace) return false;
    return this.isPublicFavorite(jockey, racecard);
  }

  isPublicFavorite(jockey: string, racecard: Racecard): boolean {
    if (!racecard.odds) return false;

    const order = this.getStarter(jockey, racecard).order;
    // @ts-ignore
    const favouredOrder = racecard.odds.winPlace
      .map(o => o)
      .sort((o1, o2) => o1.win - o2.win)
      .shift()
      .order;

    return order === favouredOrder;
  }

  isPersonalFavorite(starter: Starter, racecard: Racecard): boolean {
    return racecard.favorites.includes(starter.order);
  }

  isActiveFavorite(starter: Starter): boolean {
    return this.activeRacecard.favorites.includes(starter.order);
  }

  toggleFavoriteInTable = (race: number, starter: Starter) => {
    this.activeRace = race;
    this.toggleFavorite(starter);
  }

  toggleFavorite = (starter: Starter) => {
    const order = starter.order;
    let newFavorites = this.activeRacecard.favorites.map(f => f);

    if (newFavorites.includes(order)) {
      newFavorites = newFavorites.filter(f => f !== order)
    } else {
      newFavorites.push(order)
    }

    this.repo.saveFavorite({
      meeting: this.currentMeeting,
      race: this.activeRace,
      favorites: newFavorites
    });
  }

  isPreferredWQWR(starter: Starter): boolean {
    const wp = this.getActiveStarterWinPlaceOdds(starter);
    if (wp.win == 0 || wp.place == 0) return false;

    const W = wp.win;
    const QW = this.getActiveStarterQWOdds(starter)
    if (QW > W) return false;

    if (W < 10 && (W - QW <= 1.5)) {
      return true;
    }
    return Math.abs(1 - W / QW) <= 0.2;
  }

  getActiveStarterQWOdds(starter: Starter): number {
    const qqpWP = this.getQQPWinPlaceOdds(starter.order, this.activeRacecard);
    return parseFloat(qqpWP[0].toFixed(2));
  }

  isFinalFCTCombination(starterA: Starter, starterB: Starter): boolean {
    const placings = [starterA, starterB]
      .map(s => this.getPlacing(s.jockey, this.activeRacecard));
    return placings[0] === 1 && placings[1] === 2;
  }

  isFCTOddsWithinRange(starterA: Starter, starterB: Starter): boolean[] {
    return this.getActiveStarterFCTOdds(starterA, starterB)
      .map(o => o > 0 && o < 300);
  }

  getActiveStarterFCTOdds(starterA: Starter, starterB: Starter): number[] {
    const fct = this.activeRacecard?.odds?.forecast;
    if (!fct) return [0, 0];

    const pairs = fct.filter(comb =>
      comb.orders.includes(starterA.order) &&
      comb.orders.includes(starterB.order)
    )

    if (pairs.length !== 2) return [0, 0];
    if (pairs[0].orders[0] === starterA.order) return pairs.map(p => p.odds);
    return pairs.reverse().map(p => p.odds);
  }

  isFinalQQPCombination(starterA: Starter, starterB: Starter): boolean[] {
    const placingSum = [starterA, starterB]
      .map(s => this.getPlacing(s.jockey, this.activeRacecard))
      .map(p => [0, 4].includes(p) ? 9 : p)
      .reduce((prev, curr) => prev + curr, 0);
    return [
      placingSum === 3,
      [3, 4, 5].includes(placingSum),
    ]
  }

  isQQPOddsWithinRange(starterA: Starter, starterB: Starter): boolean[] {
    const qqp = this.getActiveStarterQQPOdds(starterA, starterB);
    return [
      qqp[0] > 0 && qqp[0] < 150,
      qqp[1] > 0 && qqp[1] < 75,
    ]
  }

  getActiveStarterQQPOdds(starterA: Starter, starterB: Starter): number[] {
    if (!this.activeRacecard?.odds) return [0, 0];
    const qin = this.activeRacecard.odds?.quinella;
    const qpl = this.activeRacecard.odds?.quinellaPlace;

    return [qin, qpl].map(pairs => {
      if (!pairs) return 0;
      return pairs
        .filter(p => p.orders.includes(starterA.order))
        .filter(p => p.orders.includes(starterB.order))
        .pop()
        ?.odds || 0;
    });
  }

  getActiveStarterWinPlaceOdds(starter: Starter): WinPlaceOdds {
    if (!this.activeRacecard) return {order: starter.order, win: 0, place: 0};
    return this.getWinPlaceOdds(starter.jockey, this.activeRacecard);
  }

  getActiveStarterWQPInvestments(starter: Starter): Array<{ percent: string, amount: string }> {
    const pool = this.activeRacecard?.pool;
    if (!pool) return [];

    const WP = this.getActiveStarterWinPlaceOdds(starter);
    const QW = this.getActiveStarterQWOdds(starter);

    return [
      {odds: WP.win, amount: pool.win},
      {odds: QW, amount: pool.quinella},
      {odds: 3 * WP.place, amount: pool.place}
    ].map(o => ({
      percent: `${(100 * PAYOUT_RATE / o.odds).toFixed(1)}%`,
      amount: `$${(o.amount * PAYOUT_RATE / o.odds / ONE_MILLION).toFixed(2)}M`
    }));
  }

  getWinPlaceOdds(jockey: string, racecard: Racecard): WinPlaceOdds {
    const order = this.getStarter(jockey, racecard).order;
    const defaultValue = {order: order, win: 0, place: 0};
    if (!racecard.odds) return defaultValue;

    return racecard.odds.winPlace
      .filter(o => o.order === order)
      .pop() || defaultValue;
  }

  getQQPWinPlaceOdds(order: number, racecard: Racecard): number[] {
    const qin = racecard.odds?.quinella;
    const qpl = racecard.odds?.quinellaPlace;

    return [qin, qpl].map(pairs => {
      if (!pairs) return 1;
      return 2 * PAYOUT_RATE / pairs
        .filter(p => p.orders.includes(order))
        .map(p => p.odds)
        .map(o => PAYOUT_RATE / o)
        .reduce((prev, curr) => prev + curr, 0);
    });
  }

  getQQPCellColor(starterA: Starter, starterB: Starter): string {
    if (starterA.order === starterB.order) return ``;
    const isBothFavorite =
      this.isActiveFavorite(starterA) &&
      this.isActiveFavorite(starterB)

    return isBothFavorite ? `bg-gray-600` : ``;
  }

  getTrainer(jockey: string, racecard: Racecard): string {
    return this.getStarter(jockey, racecard).trainer;
  }

  getStarter(jockey: string, racecard: Racecard): Starter {
    // @ts-ignore
    return racecard.starters.filter(s => s.jockey === jockey).pop();
  }

  getHorseProfileUrl(horse: string): string {
    return `
        https://racing.hkjc.com/racing/information/
        English/Horse/Horse.aspx?HorseNo=${horse}
    `.replace(/\s/g, '');
  }

  isTrainerLastRace(jockey: string, racecard: Racecard): boolean {
    if (racecard.race === this.maxRace) return false;

    const trainer = this.getTrainer(jockey, racecard);
    return racecard === this.racecards
      .filter(r => r.starters.map(s => s.trainer).includes(trainer))
      .pop();
  }

  emphasiseTrainer(jockey: string, racecard: Racecard): boolean {
    if (racecard.race >= this.maxRace - 1) return false;
    if (this.isTrainerLastRace(jockey, racecard)) return false;

    const next = racecard.race + 1;
    const trainer = this.getTrainer(jockey, racecard);

    // @ts-ignore
    return !this.racecards
      .filter(r => r.race === next)
      .pop()
      .starters
      .map(s => s.trainer)
      .includes(trainer);
  }

  hideBottomBorder(jockey: string, racecard: Racecard): boolean {
    return !(
      racecard.race === this.lastRace
      || racecard.race === this.maxRace
      || this.rideThisRace(jockey, racecard)
      || this.rideNextRace(jockey, racecard)
    )
  }

  hideRightBorder(jockey: string, racecard: Racecard): boolean {
    return !(
      jockey === this.jockeys.pop()
      || this.isBoundaryJockey(jockey)
      || this.rideThisRace(jockey, racecard)
      || this.rideThisRace(this.jockeys[this.jockeys.indexOf(jockey) + 1], racecard)
    )
  }

  rideThisRace(jockey: string, racecard: Racecard): boolean {
    return racecard.starters.map(s => s.jockey).includes(jockey);
  }

  rideNextRace(jockey: string, racecard: Racecard): boolean {
    if (racecard.race >= this.maxRace) return false;

    const nextRacecard =
      this.racecards.filter(r => r.race === racecard.race + 1).pop();

    // @ts-ignore
    return this.rideThisRace(jockey, nextRacecard);
  }

  isSpecialRace(race: Racecard): boolean {
    return !(
      race.track === 'Turf'
      && race.grade.startsWith('C')
      && race.distance > 1000
      && (!race.name.includes('CUP'))
      && (!race.name.includes('TROPHY'))
      && (!race.name.includes('CHAMPIONSHIP'))
      && (
        race.grade.endsWith('3')
        || race.grade.endsWith('4')
        || race.grade.endsWith('5')
      )
    )
  }

  isBoundaryJockey(jockey: string): boolean {
    let specials = []
    for (const j of BOUNDARY_JOCKEYS) {
      if (this.jockeys.includes(j)) {
        if (this.jockeys.indexOf(j) !== this.jockeys.length - 1) {
          specials.push(j);
        }
      } else {
        let priorIndex = JOCKEYS.map(j => j.code).indexOf(j);
        let priorJockey = j;
        while (!this.jockeys.includes(priorJockey) && priorIndex > 0) {
          priorIndex -= 1;
          priorJockey = JOCKEYS[priorIndex].code;
        }
        specials.push(priorJockey);
      }
    }
    return specials.includes(jockey);
  }

  formatMeeting(meeting: string): string {
    return meeting.replace(/^\d{4}-/g, '')
  }

  formatRaceGrade(grade: string): string {
    const clean = grade
      .replace('(', '')
      .replace(')', '')
      .replace('RESTRICTED', '')
      .replace('4 YEAR OLDS', '4Y')
      .replace('GRIFFIN RACE', 'GF')
      .trim();
    return `${clean[0]}${clean.slice(-1)}`
  }

  getStarterTooltip(jockey: string, racecard: Racecard): string {
    const starter = racecard.starters.filter(s => s.jockey === jockey).pop();
    if (!starter) return '';
    return `
      <div class="w-44 text-center">
        <div>${starter.horseNameCH}</div>
        <div>${starter.horseNameEN}</div>
      </div>
    `;
  }

  getRaceTooltip(racecard: Racecard): string {
    const name = racecard.name
      .replace('(', '')
      .replace(')', '')
      .replace('HANDICAP', '')
      .replace('CHINESE NEW YEAR', 'CNY')
      .replace('INTERNATIONAL JOCKEYS\' CHAMPIONSHIP', 'IJC')
      .trim();

    const dt = new Date(racecard.time);
    let time = `${dt.getHours()} : ${dt.getMinutes()}`;
    if (dt.getMinutes() === 0) time += '0';
    else if (dt.getMinutes() < 10) {
      time = `${dt.getHours()} : 0${dt.getMinutes()}`;
    }

    let track = racecard.track.toUpperCase();
    if (track !== 'TURF') track = 'AWT';
    const trackColor = track === 'TURF' ? 'text-green-600' : 'text-orange-400';

    const prize = `$${(racecard.prize / ONE_MILLION).toFixed(2)}M`;

    return `
      <div class="w-44">
        <div class="text-center">${name}</div>
        <div class="flex flex-row justify-evenly">
          <div class="text-red-600">${time}</div>
          <div class="${trackColor}">${track}</div>
          <div class="text-yellow-400">${prize}</div>
        </div>
      </div>
    `;
  }

  get pools(): Array<{ pool: string, amount: string }> {
    // @ts-ignore
    const pool = (this.next || this.racecards[this.racecards.length - 1])?.pool;
    if (!pool) return [];

    return [
      {pool: 'W', amount: (pool.win / ONE_MILLION).toFixed(2)},
      {pool: 'Q', amount: (pool.quinella / ONE_MILLION).toFixed(2)},
      {pool: 'FT', amount: (pool.forecast / ONE_MILLION).toFixed(2)},
      {pool: 'TCE', amount: (pool.tierce / ONE_MILLION).toFixed(2)},
      {pool: 'P', amount: (pool.place / ONE_MILLION).toFixed(2)},
      {pool: 'QP', amount: ((pool?.quinellaPlace || 0) / ONE_MILLION).toFixed(2)},
      {pool: 'FQ', amount: ((pool?.quartet || 0) / ONE_MILLION).toFixed(2)},
      {pool: 'DBL', amount: ((pool?.double || 0) / ONE_MILLION).toFixed(2)},
    ]
  }

  get maxRace(): number {
    return this.racecards.map(r => r.race).pop() || 0;
  }

  get lastRace(): number {
    return this.nextRace - 1;
  }

  get nextRace(): number {
    return this.next?.race || 13;
  }

  get next(): Racecard {
    // @ts-ignore
    return this.racecards.filter(r => !r.dividend?.win).shift();
  }

  get activeRacecard(): Racecard {
    // @ts-ignore
    return this.racecards.filter(r => r.race === this.activeRace).pop();
  }

  get activeStarters(): Starter[] {
    if (!this.activeRacecard) return [];

    return this.activeRacecard.starters.sort((s1, s2) => {
      const odds1 = this.getWinPlaceOdds(s1.jockey, this.activeRacecard);
      const odds2 = this.getWinPlaceOdds(s2.jockey, this.activeRacecard);

      return odds1.win - odds2.win
        || odds1.place - odds2.place
        || this.jockeys.indexOf(s1.jockey) - this.jockeys.indexOf(s2.jockey);
    });
  }

  get starters(): Starter[] {
    return this.racecards
      .map(r => r.starters)
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  get trainers(): string[] {
    const meetingTrainers = new Set(this.starters.map(s => s.trainer));
    return TRAINERS.map(t => t.code).filter(t => meetingTrainers.has(t));
  }

  get jockeys(): string[] {
    const meetingJockeys = new Set(this.starters.map(s => s.jockey));
    return JOCKEYS.map(j => j.code).filter(j => meetingJockeys.has(j));
  }

  get currentMeeting(): string {
    const racecard = this.racecards.find(r => r.race === 1);
    if (!racecard) return '---';
    return racecard.meeting;
  }

  get meetingSummary(): string {
    const racecard = this.racecards.find(r => r.race === 1);
    if (!racecard) return '---';

    const date = racecard.meeting;
    const venue = racecard.venue;
    const course = this.racecards.find(r => r.course)?.course || 'AWT';
    const total = this.racecards.length;
    const dayOfWeek = new Date(date)
      .toLocaleDateString('en-US', {weekday: 'short'})
      .toUpperCase();

    const horses = this.starters.length;
    const jockeys = this.jockeys.length;
    const trainers = this.trainers.length;

    return `
        ${dayOfWeek}, ${date}, ${venue}, ${course} Course x
        ${total} Races, ${jockeys} Jockeys, ${trainers} Trainers, ${horses} Horses
    `;
  }
}