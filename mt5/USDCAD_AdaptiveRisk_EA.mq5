//+------------------------------------------------------------------+
//| USDCAD Adaptive Risk EA                                          |
//| Expert Advisor profesional para MetaTrader 5                     |
//| Activo: USDCAD, Timeframe principal: M5                          |
//+------------------------------------------------------------------+
#property strict
#property version   "2.00"
#property description "EA USDCAD institucional: contexto multi-horizonte, scoring, riesgo fijo, noticias, BE, trailing ATR y panel profesional."

#include <Trade/Trade.mqh>
#include <Trade/PositionInfo.mqh>
#include <Trade/DealInfo.mqh>

enum ENUM_GROWTH_MODE
{
   MODE_CONSERVATIVE = 0,
   MODE_MODERATE     = 1,
   MODE_ADVANCED     = 2
};

enum ENUM_MARKET_ZONE
{
   ZONE_LOW = 0,
   ZONE_MID = 1,
   ZONE_HIGH = 2
};

enum ENUM_SIGNAL
{
   SIGNAL_NONE = 0,
   SIGNAL_BUY  = 1,
   SIGNAL_SELL = -1
};

input group "General"
input string InpAllowedSymbol                 = "USDCAD";
input ENUM_TIMEFRAMES InpSignalTimeframe      = PERIOD_M5;
input ulong  InpMagicNumber                   = 2026062001;
input bool   InpDemoOnly                      = true;
input bool   InpAllowNewEntries               = true;
input int    InpSlippagePoints                = 20;

input group "Riesgo"
input double InpRiskPercent                   = 1.0;
input double InpMaxDailyDrawdownPercent       = 4.0;
input double InpMaxTotalRiskPercent           = 5.0;
input double InpMaxSpreadPoints               = 25.0;
input bool   InpUseMinLotInConservative       = true;
input int    InpMinMinutesBetweenEntries      = 30;
input int    InpTargetOpenPositions           = 3;
input int    InpMaxConservativePositions      = 3;
input int    InpMaxModeratePositions          = 3;
input int    InpMaxAdvancedPositions          = 5;
input bool   InpFillTargetPositions           = true;
input bool   InpBypassCooldownUntilTarget     = true;

input group "Indicadores"
input int    InpEmaFastPeriod                 = 5;
input int    InpSmaMidPeriod                  = 50;
input int    InpSmaSlowPeriod                 = 200;
input int    InpAtrPeriod                     = 14;
input double InpMinAtrPoints                  = 35.0;

input group "SL, TP, Break Even y Trailing"
input double InpAtrSlMultiplier               = 1.7;
input double InpAtrTrailingMultiplier         = 1.2;
input double InpVolatileAtrMultiplier         = 1.35;
input double InpBaseRewardRisk                = 2.0;
input double InpVolatileRewardRisk            = 3.0;
input double InpBreakEvenAtTargetPercent      = 50.0;
input double InpBreakEvenExtraPoints          = 3.0;
input bool   InpUseAdvancedTrailingOnly       = false;

input group "Zonas Historicas"
input bool   InpUseHistoricalZones            = true;
input int    InpHistoricalDays                = 20;
input int    InpHistoricalWeeks               = 26;
input int    InpHistoricalMonths              = 12;
input int    InpHistoricalYears               = 5;
input double InpZoneBiasFactor                = 0.55;
input int    InpZoneRefreshDayOfWeek          = 1;

input group "Motor Institucional"
input double InpMinDecisionScore              = 68.0;
input int    InpContextRefreshSeconds         = 60;
input int    InpMaxRatesPerHorizon            = 2500;
input int    InpFullHistoryMaxBars            = 7500;
input double InpLiquidityProximityAtr         = 0.35;
input double InpFvgMinAtrFraction             = 0.18;
input double InpOrderBlockBodyAtrFraction     = 0.55;
input double InpStrongTrendThreshold          = 0.58;

input group "Noticias"
input bool   InpUseEconomicCalendar           = true;
input int    InpNewsBlockMinutesBefore        = 45;
input int    InpNewsBlockMinutesAfter         = 45;
input string InpNewsKeywords                  = "CPI,NFP,FOMC,Nonfarm,Payroll,Interest Rate,Rate Decision,Employment Change,Bank of Canada,BoC,Federal Reserve";
input bool   InpSendNewsTelegramAlert         = true;

input group "Telegram"
input bool   InpUseTelegram                   = false;
input string InpTelegramBotToken              = "";
input string InpTelegramChatId                = "";
input bool   InpSendTradeOpenAlerts           = true;
input bool   InpSendTradeCloseAlerts          = true;
input bool   InpSendDailySummary              = true;
input bool   InpSendWeeklySummary             = true;

input group "Panel"
input bool   InpShowPanel                     = true;
input int    InpPanelCorner                   = CORNER_LEFT_UPPER;
input int    InpPanelX                        = 12;
input int    InpPanelY                        = 22;
input color  InpPanelTextColor                = clrWhite;
input color  InpPanelBgColor                  = clrDarkSlateGray;

CTrade       Trade;
CPositionInfo Position;
CDealInfo    Deal;

int hEmaFast = INVALID_HANDLE;
int hSmaMid  = INVALID_HANDLE;
int hSmaSlow = INVALID_HANDLE;
int hAtr     = INVALID_HANDLE;

datetime g_lastBarTime = 0;
datetime g_lastZoneRefresh = 0;
datetime g_currentDayStart = 0;
datetime g_currentWeekStart = 0;
datetime g_lastDailySummary = 0;
datetime g_lastWeeklySummary = 0;
datetime g_lastNewsAlert = 0;
datetime g_lastNewsRefresh = 0;
datetime g_cachedNewsTime = 0;
string g_cachedNewsText = "No disponible";
datetime g_lastEntryTime = 0;
ENUM_SIGNAL g_lastEntrySignal = SIGNAL_NONE;

double g_dayStartEquity = 0.0;
double g_weekStartEquity = 0.0;
double g_histHigh = 0.0;
double g_histLow = 0.0;
double g_histAvgRange = 0.0;
double g_zoneLowTop = 0.0;
double g_zoneHighBottom = 0.0;
ENUM_MARKET_ZONE g_zone = ZONE_MID;
bool g_dailyLock = false;

struct SRangeProfile
{
   double high;
   double low;
   double range;
   double lowTop;
   double highBottom;
   double pricePosition;
   int bars;
   bool ready;
};

SRangeProfile g_dailyRange;
SRangeProfile g_weeklyRange;
SRangeProfile g_monthlyRange;
SRangeProfile g_yearlyRange;
SRangeProfile g_compositeRange;

#define HORIZON_COUNT 16

struct SHorizonProfile
{
   string label;
   ENUM_TIMEFRAMES timeframe;
   int requestedBars;
   int bars;
   datetime fromTime;
   datetime toTime;
   double high;
   double low;
   double mean;
   double atr;
   double volatility;
   double slope;
   double trendStrength;
   int trendDirection;
   double distanceToHigh;
   double distanceToLow;
   double support;
   double resistance;
   double liquidityHigh;
   double liquidityLow;
   double orderBlockBull;
   double orderBlockBear;
   double fairValueGapBull;
   double fairValueGapBear;
   double supply;
   double demand;
   bool breakOfStructureBull;
   bool breakOfStructureBear;
   bool changeOfCharacterBull;
   bool changeOfCharacterBear;
   bool ready;
};

struct SDecisionState
{
   datetime lastAnalysisTime;
   int totalCandles;
   double buyScore;
   double sellScore;
   double signalQuality;
   double confidence;
   double expectedProfitMoney;
   double riskAvailableMoney;
   double currentAtr;
   double currentVolatility;
   string marketContext;
   string eaState;
   string buyReason;
   string sellReason;
   string blockReason;
   string nextNews;
   int minutesToNews;
   ENUM_SIGNAL preferredSignal;
};

SHorizonProfile g_horizons[HORIZON_COUNT];
SDecisionState g_decision;
datetime g_lastContextRefresh = 0;

struct SStats
{
   int wins;
   int losses;
   int trades;
   double grossProfit;
   double grossLoss;
   double maxDrawdownMoney;
   double peakEquity;
   double monthlyProfit;
   double annualProfit;
   double avgRewardRisk;
};

SStats g_stats;

//+------------------------------------------------------------------+
//| Utilidades de tiempo                                             |
//+------------------------------------------------------------------+
datetime DayStart(datetime when)
{
   MqlDateTime dt;
   TimeToStruct(when, dt);
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   return StructToTime(dt);
}

datetime WeekStart(datetime when)
{
   MqlDateTime dt;
   TimeToStruct(DayStart(when), dt);
   int dow = dt.day_of_week;
   int daysFromMonday = (dow == 0 ? 6 : dow - 1);
   return DayStart(when) - daysFromMonday * 86400;
}

string ModeToString(ENUM_GROWTH_MODE mode)
{
   if(mode == MODE_CONSERVATIVE) return "Conservador";
   if(mode == MODE_MODERATE) return "Moderado";
   return "Avanzado";
}

string ZoneToString(ENUM_MARKET_ZONE zone)
{
   if(zone == ZONE_LOW) return "Zona baja";
   if(zone == ZONE_HIGH) return "Zona alta";
   return "Zona media";
}

//+------------------------------------------------------------------+
//| Estado de cuenta y mercado                                       |
//+------------------------------------------------------------------+
ENUM_GROWTH_MODE GetGrowthMode()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(balance < 200.0) return MODE_CONSERVATIVE;
   if(balance <= 500.0) return MODE_MODERATE;
   return MODE_ADVANCED;
}

int MaxPositionsForMode(ENUM_GROWTH_MODE mode)
{
   if(mode == MODE_CONSERVATIVE) return MathMax(1, InpMaxConservativePositions);
   if(mode == MODE_MODERATE) return MathMax(1, InpMaxModeratePositions);
   return MathMax(1, InpMaxAdvancedPositions);
}

int TargetPositionsForMode(ENUM_GROWTH_MODE mode)
{
   int maxAllowed = MaxPositionsForMode(mode);
   return MathMax(1, MathMin(InpTargetOpenPositions, maxAllowed));
}

bool IsAllowedEnvironment()
{
   if(_Symbol != InpAllowedSymbol)
   {
      PrintFormat("EA bloqueado: simbolo actual %s, permitido %s.", _Symbol, InpAllowedSymbol);
      return false;
   }

   if(InpDemoOnly && AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("EA en modo DEMO_ONLY: no operara en cuenta real.");
      return false;
   }

   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
      || !MQLInfoInteger(MQL_TRADE_ALLOWED)
      || !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      Print("EA bloqueado: trading automatico no permitido por terminal, MQL o cuenta.");
      return false;
   }

   return true;
}

bool IsNewBar()
{
   datetime current = iTime(_Symbol, InpSignalTimeframe, 0);
   if(current == 0) return false;
   if(current != g_lastBarTime)
   {
      g_lastBarTime = current;
      return true;
   }
   return false;
}

double SpreadPoints()
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return DBL_MAX;
   return (tick.ask - tick.bid) / _Point;
}

bool IsSpreadAcceptable()
{
   return SpreadPoints() <= InpMaxSpreadPoints;
}

int CountOpenPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(Position.SelectByIndex(i)
         && Position.Symbol() == _Symbol
         && Position.Magic() == InpMagicNumber)
      {
         count++;
      }
   }
   return count;
}

bool EntryCooldownPassed(ENUM_SIGNAL signal, string &reason)
{
   if(signal == SIGNAL_NONE) return true;
   if(InpMinMinutesBetweenEntries <= 0 || g_lastEntryTime <= 0)
      return true;

   if(InpBypassCooldownUntilTarget && CountOpenPositions() < TargetPositionsForMode(GetGrowthMode()))
      return true;

   int elapsed = (int)((TimeCurrent() - g_lastEntryTime) / 60);
   if(elapsed < InpMinMinutesBetweenEntries)
   {
      AppendReason(reason, StringFormat("cooldown entrada %d/%d min", elapsed, InpMinMinutesBetweenEntries));
      return false;
   }
   return true;
}

double CurrentOpenRiskMoney()
{
   double totalRisk = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!Position.SelectByIndex(i)) continue;
      if(Position.Symbol() != _Symbol || Position.Magic() != InpMagicNumber) continue;

      double open = Position.PriceOpen();
      double sl = Position.StopLoss();
      double volume = Position.Volume();
      if(sl <= 0.0) continue;

      double points = MathAbs(open - sl) / _Point;
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickValue <= 0.0 || tickSize <= 0.0) continue;

      totalRisk += points * _Point / tickSize * tickValue * volume;
   }
   return totalRisk;
}

bool DailyDrawdownExceeded()
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_dayStartEquity <= 0.0) return false;
   double ddPercent = (g_dayStartEquity - equity) / g_dayStartEquity * 100.0;
   return ddPercent >= InpMaxDailyDrawdownPercent;
}

void RefreshPeriodAnchors()
{
   datetime now = TimeCurrent();
   datetime day = DayStart(now);
   datetime week = WeekStart(now);

   if(day != g_currentDayStart)
   {
      g_currentDayStart = day;
      g_dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_dailyLock = false;
   }

   if(week != g_currentWeekStart)
   {
      g_currentWeekStart = week;
      g_weekStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   }

   if(DailyDrawdownExceeded())
      g_dailyLock = true;
}

//+------------------------------------------------------------------+
//| Indicadores                                                      |
//+------------------------------------------------------------------+
bool CopyIndicatorValue(int handle, int buffer, int shift, double &value)
{
   double data[1];
   if(CopyBuffer(handle, buffer, shift, 1, data) != 1) return false;
   value = data[0];
   return true;
}

bool GetSignalData(double &ema1, double &ema2, double &sma50_1, double &sma50_2,
                   double &sma200_1, double &atr1, double &close1)
{
   if(!CopyIndicatorValue(hEmaFast, 0, 1, ema1)) return false;
   if(!CopyIndicatorValue(hEmaFast, 0, 2, ema2)) return false;
   if(!CopyIndicatorValue(hSmaMid, 0, 1, sma50_1)) return false;
   if(!CopyIndicatorValue(hSmaMid, 0, 2, sma50_2)) return false;
   if(!CopyIndicatorValue(hSmaSlow, 0, 1, sma200_1)) return false;
   if(!CopyIndicatorValue(hAtr, 0, 1, atr1)) return false;
   close1 = iClose(_Symbol, InpSignalTimeframe, 1);
   return close1 > 0.0;
}

//+------------------------------------------------------------------+
//| Motor de contexto institucional                                  |
//+------------------------------------------------------------------+
void InitializeHorizons()
{
   g_horizons[0].label = "ALL";  g_horizons[0].timeframe = PERIOD_D1;  g_horizons[0].requestedBars = 0;
   g_horizons[1].label = "10Y";  g_horizons[1].timeframe = PERIOD_MN1; g_horizons[1].requestedBars = 120;
   g_horizons[2].label = "5Y";   g_horizons[2].timeframe = PERIOD_MN1; g_horizons[2].requestedBars = 60;
   g_horizons[3].label = "3Y";   g_horizons[3].timeframe = PERIOD_W1;  g_horizons[3].requestedBars = 156;
   g_horizons[4].label = "1Y";   g_horizons[4].timeframe = PERIOD_D1;  g_horizons[4].requestedBars = 252;
   g_horizons[5].label = "6M";   g_horizons[5].timeframe = PERIOD_D1;  g_horizons[5].requestedBars = 126;
   g_horizons[6].label = "3M";   g_horizons[6].timeframe = PERIOD_D1;  g_horizons[6].requestedBars = 63;
   g_horizons[7].label = "1M";   g_horizons[7].timeframe = PERIOD_H4;  g_horizons[7].requestedBars = 180;
   g_horizons[8].label = "1W";   g_horizons[8].timeframe = PERIOD_H1;  g_horizons[8].requestedBars = 168;
   g_horizons[9].label = "1D";   g_horizons[9].timeframe = PERIOD_M15; g_horizons[9].requestedBars = 96;
   g_horizons[10].label = "24H"; g_horizons[10].timeframe = PERIOD_M15; g_horizons[10].requestedBars = 96;
   g_horizons[11].label = "12H"; g_horizons[11].timeframe = PERIOD_M15; g_horizons[11].requestedBars = 48;
   g_horizons[12].label = "4H";  g_horizons[12].timeframe = PERIOD_M5;  g_horizons[12].requestedBars = 48;
   g_horizons[13].label = "1H";  g_horizons[13].timeframe = PERIOD_M5;  g_horizons[13].requestedBars = 12;
   g_horizons[14].label = "15M"; g_horizons[14].timeframe = PERIOD_M1;  g_horizons[14].requestedBars = 15;
   g_horizons[15].label = "5M";  g_horizons[15].timeframe = PERIOD_M1;  g_horizons[15].requestedBars = 5;
}

double Clamp(double value, double minValue, double maxValue)
{
   return MathMax(minValue, MathMin(maxValue, value));
}

double SafeDiv(double numerator, double denominator, double fallback = 0.0)
{
   if(MathAbs(denominator) <= DBL_EPSILON) return fallback;
   return numerator / denominator;
}

double AverageRange(const MqlRates &rates[], int total, int fromIndex, int count)
{
   double sum = 0.0;
   int used = 0;
   int end = MathMin(total, fromIndex + count);
   for(int i = fromIndex; i < end; i++)
   {
      sum += rates[i].high - rates[i].low;
      used++;
   }
   return used > 0 ? sum / used : 0.0;
}

double AverageBody(const MqlRates &rates[], int total, int fromIndex, int count)
{
   double sum = 0.0;
   int used = 0;
   int end = MathMin(total, fromIndex + count);
   for(int i = fromIndex; i < end; i++)
   {
      sum += MathAbs(rates[i].close - rates[i].open);
      used++;
   }
   return used > 0 ? sum / used : 0.0;
}

void DetectFairValueGaps(const MqlRates &rates[], int total, double minGap, double &bullGap, double &bearGap)
{
   bullGap = 0.0;
   bearGap = 0.0;
   for(int i = 1; i < total - 1; i++)
   {
      if(rates[i + 1].high < rates[i - 1].low)
      {
         double gap = rates[i - 1].low - rates[i + 1].high;
         if(gap >= minGap)
            bullGap = (rates[i - 1].low + rates[i + 1].high) / 2.0;
      }
      if(rates[i + 1].low > rates[i - 1].high)
      {
         double gap = rates[i + 1].low - rates[i - 1].high;
         if(gap >= minGap)
            bearGap = (rates[i + 1].low + rates[i - 1].high) / 2.0;
      }
      if(bullGap > 0.0 && bearGap > 0.0) return;
   }
}

void DetectOrderBlocks(const MqlRates &rates[], int total, double minBody, double &bullOb, double &bearOb)
{
   bullOb = 0.0;
   bearOb = 0.0;
   for(int i = 2; i < total - 1; i++)
   {
      double body = MathAbs(rates[i].close - rates[i].open);
      double nextBody = MathAbs(rates[i - 1].close - rates[i - 1].open);
      bool bearishCandle = rates[i].close < rates[i].open;
      bool bullishCandle = rates[i].close > rates[i].open;
      bool bullishImpulse = rates[i - 1].close > rates[i - 1].open && nextBody >= minBody;
      bool bearishImpulse = rates[i - 1].close < rates[i - 1].open && nextBody >= minBody;

      if(bullOb <= 0.0 && bearishCandle && bullishImpulse && body >= minBody * 0.35)
         bullOb = (rates[i].open + rates[i].low) / 2.0;

      if(bearOb <= 0.0 && bullishCandle && bearishImpulse && body >= minBody * 0.35)
         bearOb = (rates[i].open + rates[i].high) / 2.0;

      if(bullOb > 0.0 && bearOb > 0.0) return;
   }
}

bool BuildHorizonProfile(int index)
{
   SHorizonProfile hp = g_horizons[index];
   hp.ready = false;
   hp.bars = 0;

   int bars = hp.requestedBars;
   if(bars <= 0)
      bars = MathMin(MathMax(Bars(_Symbol, hp.timeframe) - 1, 5), InpFullHistoryMaxBars);
   else
      bars = MathMin(MathMax(bars, 5), InpMaxRatesPerHorizon);
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, hp.timeframe, 1, bars, rates);
   if(copied < 5 && bars > 12)
      copied = CopyRates(_Symbol, hp.timeframe, 1, 12, rates);
   if(copied < 5)
   {
      g_horizons[index] = hp;
      return false;
   }

   double high = rates[0].high;
   double low = rates[0].low;
   double sumClose = 0.0;
   double sumRange = 0.0;
   double sumVol = 0.0;

   for(int i = 0; i < copied; i++)
   {
      high = MathMax(high, rates[i].high);
      low = MathMin(low, rates[i].low);
      sumClose += rates[i].close;
      sumRange += rates[i].high - rates[i].low;
      sumVol += (double)rates[i].tick_volume;
   }

   double mean = sumClose / copied;
   double range = high - low;
   double atr = AverageRange(rates, copied, 0, MathMin(InpAtrPeriod, copied));
   if(atr <= 0.0) atr = sumRange / copied;

   double current = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   int slopeBars = MathMin(20, copied - 1);
   double slope = rates[0].close - rates[slopeBars].close;
   double trendStrength = Clamp(MathAbs(slope) / MathMax(atr * MathSqrt((double)slopeBars), _Point), 0.0, 1.0);
   int trendDirection = slope > atr * 0.10 ? 1 : (slope < -atr * 0.10 ? -1 : 0);

   int pivotWindow = MathMin(20, copied);
   double support = rates[0].low;
   double resistance = rates[0].high;
   for(int i = 0; i < pivotWindow; i++)
   {
      support = MathMin(support, rates[i].low);
      resistance = MathMax(resistance, rates[i].high);
   }
   double avgVol = sumVol / copied;
   double liquidityHigh = resistance;
   double liquidityLow = support;

   for(int i = 1; i < copied - 1; i++)
   {
      if((double)rates[i].tick_volume >= avgVol * 1.35)
      {
         if(rates[i].high >= resistance - atr * InpLiquidityProximityAtr)
            liquidityHigh = MathMax(liquidityHigh, rates[i].high);
         if(rates[i].low <= support + atr * InpLiquidityProximityAtr)
            liquidityLow = MathMin(liquidityLow, rates[i].low);
      }
   }

   double bullFvg, bearFvg, bullOb, bearOb;
   DetectFairValueGaps(rates, copied, atr * InpFvgMinAtrFraction, bullFvg, bearFvg);
   DetectOrderBlocks(rates, copied, atr * InpOrderBlockBodyAtrFraction, bullOb, bearOb);

   bool bosBull = rates[0].close > resistance;
   bool bosBear = rates[0].close < support;
   bool chochBull = trendDirection > 0 && copied > 6 && rates[0].close > rates[3].high && rates[3].close < rates[6].close;
   bool chochBear = trendDirection < 0 && copied > 6 && rates[0].close < rates[3].low && rates[3].close > rates[6].close;

   hp.high = high;
   hp.low = low;
   hp.mean = mean;
   hp.atr = atr;
   hp.volatility = SafeDiv(atr, current, 0.0) * 100.0;
   hp.slope = slope;
   hp.trendStrength = trendStrength;
   hp.trendDirection = trendDirection;
   hp.distanceToHigh = high > 0.0 ? (high - current) / _Point : 0.0;
   hp.distanceToLow = low > 0.0 ? (current - low) / _Point : 0.0;
   hp.support = support;
   hp.resistance = resistance;
   hp.liquidityHigh = liquidityHigh;
   hp.liquidityLow = liquidityLow;
   hp.orderBlockBull = bullOb;
   hp.orderBlockBear = bearOb;
   hp.fairValueGapBull = bullFvg;
   hp.fairValueGapBear = bearFvg;
   hp.supply = resistance;
   hp.demand = support;
   hp.breakOfStructureBull = bosBull;
   hp.breakOfStructureBear = bosBear;
   hp.changeOfCharacterBull = chochBull;
   hp.changeOfCharacterBear = chochBear;
   hp.fromTime = rates[copied - 1].time;
   hp.toTime = rates[0].time;
   hp.bars = copied;
   hp.ready = true;
   g_horizons[index] = hp;
   return true;
}

bool RefreshMarketContext(bool force = false)
{
   datetime now = TimeCurrent();
   if(!force && g_lastContextRefresh > 0 && now - g_lastContextRefresh < InpContextRefreshSeconds)
      return true;

   int ready = 0;
   int candles = 0;
   for(int i = 0; i < HORIZON_COUNT; i++)
   {
      if(BuildHorizonProfile(i))
      {
         ready++;
         candles += g_horizons[i].bars;
      }
   }

   g_decision.lastAnalysisTime = now;
   g_decision.totalCandles = candles;
   g_lastContextRefresh = now;
   return ready >= 8;
}

string TrendToText(int direction)
{
   if(direction > 0) return "Alcista";
   if(direction < 0) return "Bajista";
   return "Lateral";
}

string HorizonLine(int index)
{
   if(index < 0 || index >= HORIZON_COUNT || !g_horizons[index].ready)
      return "n/a";
   return StringFormat("%s %.5f/%.5f %s %.0f%%",
                       g_horizons[index].label,
                       g_horizons[index].low,
                       g_horizons[index].high,
                       TrendToText(g_horizons[index].trendDirection),
                       g_horizons[index].trendStrength * 100.0);
}

//+------------------------------------------------------------------+
//| Zonas historicas                                                 |
//+------------------------------------------------------------------+
bool BuildRangeProfile(ENUM_TIMEFRAMES timeframe, int bars, SRangeProfile &profile)
{
   profile.ready = false;
   profile.high = 0.0;
   profile.low = 0.0;
   profile.range = 0.0;
   profile.lowTop = 0.0;
   profile.highBottom = 0.0;
   profile.pricePosition = 50.0;
   profile.bars = 0;

   if(bars < 3) bars = 3;

   double highs[];
   double lows[];
   ArraySetAsSeries(highs, true);
   ArraySetAsSeries(lows, true);

   int copiedHighs = CopyHigh(_Symbol, timeframe, 1, bars, highs);
   int copiedLows = CopyLow(_Symbol, timeframe, 1, bars, lows);
   if((copiedHighs <= 0 || copiedLows <= 0) && bars > 12)
   {
      ResetLastError();
      copiedHighs = CopyHigh(_Symbol, timeframe, 1, 12, highs);
      copiedLows = CopyLow(_Symbol, timeframe, 1, 12, lows);
   }
   if(copiedHighs <= 0 || copiedLows <= 0) return false;

   int total = MathMin(copiedHighs, copiedLows);
   double high = highs[ArrayMaximum(highs, 0, total)];
   double low = lows[ArrayMinimum(lows, 0, total)];
   double range = high - low;
   if(range <= 0.0) return false;

   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   profile.high = high;
   profile.low = low;
   profile.range = range;
   profile.lowTop = low + range / 3.0;
   profile.highBottom = high - range / 3.0;
   profile.pricePosition = MathMax(0.0, MathMin(100.0, (price - low) / range * 100.0));
   profile.bars = total;
   profile.ready = true;
   return true;
}

bool BuildCompositeRange()
{
   if(!g_dailyRange.ready || !g_weeklyRange.ready || !g_monthlyRange.ready || !g_yearlyRange.ready)
      return false;

   double low = (g_dailyRange.low * 0.10)
              + (g_weeklyRange.low * 0.20)
              + (g_monthlyRange.low * 0.30)
              + (g_yearlyRange.low * 0.40);

   double high = (g_dailyRange.high * 0.10)
               + (g_weeklyRange.high * 0.20)
               + (g_monthlyRange.high * 0.30)
               + (g_yearlyRange.high * 0.40);

   double range = high - low;
   if(range <= 0.0) return false;

   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   g_compositeRange.high = high;
   g_compositeRange.low = low;
   g_compositeRange.range = range;
   g_compositeRange.lowTop = low + range / 3.0;
   g_compositeRange.highBottom = high - range / 3.0;
   g_compositeRange.pricePosition = MathMax(0.0, MathMin(100.0, (price - low) / range * 100.0));
   g_compositeRange.bars = g_dailyRange.bars + g_weeklyRange.bars + g_monthlyRange.bars + g_yearlyRange.bars;
   g_compositeRange.ready = true;
   return true;
}

string RangeToText(string label, const SRangeProfile &profile)
{
   if(!profile.ready) return label + ": sin datos";
   return StringFormat("%s: %.5f/%.5f %.0f%%", label, profile.low, profile.high, profile.pricePosition);
}

void RefreshHistoricalZones(bool force = false)
{
   if(!InpUseHistoricalZones) return;

   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);

   bool weeklyRefresh = (dt.day_of_week == InpZoneRefreshDayOfWeek && DayStart(now) != DayStart(g_lastZoneRefresh));
   if(!force && !weeklyRefresh && g_histHigh > 0.0 && g_histLow > 0.0) return;

   bool dailyOk = BuildRangeProfile(PERIOD_D1, InpHistoricalDays, g_dailyRange);
   bool weeklyOk = BuildRangeProfile(PERIOD_W1, InpHistoricalWeeks, g_weeklyRange);
   bool monthlyOk = BuildRangeProfile(PERIOD_MN1, InpHistoricalMonths, g_monthlyRange);
   bool yearlyOk = BuildRangeProfile(PERIOD_MN1, MathMax(12, InpHistoricalYears * 12), g_yearlyRange);
   if(!dailyOk || !weeklyOk || !monthlyOk || !yearlyOk) return;
   if(!BuildCompositeRange()) return;

   g_histHigh = g_compositeRange.high;
   g_histLow = g_compositeRange.low;
   g_histAvgRange = g_compositeRange.range;
   g_zoneLowTop = g_compositeRange.lowTop;
   g_zoneHighBottom = g_compositeRange.highBottom;
   g_lastZoneRefresh = now;

   PrintFormat("Estudio historico actualizado: D %.5f/%.5f, W %.5f/%.5f, M %.5f/%.5f, Y %.5f/%.5f, compuesto %.5f/%.5f",
               g_dailyRange.low, g_dailyRange.high,
               g_weeklyRange.low, g_weeklyRange.high,
               g_monthlyRange.low, g_monthlyRange.high,
               g_yearlyRange.low, g_yearlyRange.high,
               g_histLow, g_histHigh);
}

ENUM_MARKET_ZONE CurrentZone()
{
   if(!InpUseHistoricalZones || !g_compositeRange.ready) return ZONE_MID;
   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(price <= g_compositeRange.lowTop) return ZONE_LOW;
   if(price >= g_compositeRange.highBottom) return ZONE_HIGH;
   return ZONE_MID;
}

bool ZoneAllowsSignal(ENUM_SIGNAL signal, double atrValue)
{
   if(!InpUseHistoricalZones || signal == SIGNAL_NONE) return true;

   g_zone = CurrentZone();
   double sma50, sma200;
   if(!CopyIndicatorValue(hSmaMid, 0, 1, sma50)) return false;
   if(!CopyIndicatorValue(hSmaSlow, 0, 1, sma200)) return false;

   double trendStrength = MathAbs(sma50 - sma200);
   bool strongTrend = (atrValue > 0.0 && trendStrength >= atrValue * InpZoneBiasFactor);

   if(g_zone == ZONE_LOW && signal == SIGNAL_SELL)
      return strongTrend;

   if(g_zone == ZONE_HIGH && signal == SIGNAL_BUY)
      return strongTrend;

   return true;
}

//+------------------------------------------------------------------+
//| Calendario economico                                             |
//+------------------------------------------------------------------+
bool KeywordMatch(string text, string csv)
{
   string lowerText = text;
   StringToLower(lowerText);
   string parts[];
   int n = StringSplit(csv, ',', parts);
   for(int i = 0; i < n; i++)
   {
      string key = parts[i];
      StringToLower(key);
      StringTrimLeft(key);
      StringTrimRight(key);
      if(key != "" && StringFind(lowerText, key) >= 0)
         return true;
   }
   return false;
}

bool IsRelevantCurrency(string currency)
{
   return currency == "USD" || currency == "CAD";
}

string NextHighImpactNewsText(datetime &eventTime)
{
   if(g_lastNewsRefresh > 0 && TimeCurrent() - g_lastNewsRefresh < 300)
   {
      eventTime = g_cachedNewsTime;
      return g_cachedNewsText;
   }

   eventTime = 0;
   if(!InpUseEconomicCalendar) return "Filtro apagado";

   MqlCalendarValue values[];
   datetime from = TimeCurrent() - InpNewsBlockMinutesAfter * 60;
   datetime to = TimeCurrent() + 7 * 86400;
   if(!CalendarValueHistory(values, from, to, NULL, NULL))
      return "No disponible";

   int count = ArraySize(values);
   if(count <= 0) return "Sin noticias cercanas";

   datetime best = 0;
   string bestText = "Sin noticias cercanas";

   for(int i = 0; i < count; i++)
   {
      MqlCalendarEvent event;
      MqlCalendarCountry country;
      if(!CalendarEventById(values[i].event_id, event)) continue;
      if(!CalendarCountryById(event.country_id, country)) continue;
      if(!IsRelevantCurrency(country.currency)) continue;
      if(event.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      if(!KeywordMatch(event.name, InpNewsKeywords)) continue;

      if(best == 0 || values[i].time < best)
      {
         best = values[i].time;
         bestText = country.currency + " " + event.name + " " + TimeToString(best, TIME_DATE | TIME_MINUTES);
      }
   }

   eventTime = best;
   g_cachedNewsTime = best;
   g_cachedNewsText = bestText;
   g_lastNewsRefresh = TimeCurrent();
   return bestText;
}

bool IsNewsBlocked(string &reason)
{
   reason = "";
   if(!InpUseEconomicCalendar) return false;

   MqlCalendarValue values[];
   datetime now = TimeCurrent();
   datetime from = now - InpNewsBlockMinutesAfter * 60;
   datetime to = now + InpNewsBlockMinutesBefore * 60;
   if(!CalendarValueHistory(values, from, to, NULL, NULL))
      return false;

   int count = ArraySize(values);
   if(count <= 0) return false;

   for(int i = 0; i < count; i++)
   {
      MqlCalendarEvent event;
      MqlCalendarCountry country;
      if(!CalendarEventById(values[i].event_id, event)) continue;
      if(!CalendarCountryById(event.country_id, country)) continue;
      if(!IsRelevantCurrency(country.currency)) continue;
      if(event.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      if(!KeywordMatch(event.name, InpNewsKeywords)) continue;

      reason = country.currency + " " + event.name + " " + TimeToString(values[i].time, TIME_DATE | TIME_MINUTES);
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Telegram                                                         |
//+------------------------------------------------------------------+
string UrlEncode(string value)
{
   string result = "";
   uchar bytes[];
   StringToCharArray(value, bytes, 0, WHOLE_ARRAY, CP_UTF8);
   for(int i = 0; i < ArraySize(bytes) - 1; i++)
   {
      uchar c = bytes[i];
      if((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~')
         result += CharToString(c);
      else if(c == ' ')
         result += "%20";
      else
         result += StringFormat("%%%02X", c);
   }
   return result;
}

bool SendTelegram(string message)
{
   if(!InpUseTelegram || InpTelegramBotToken == "" || InpTelegramChatId == "")
      return false;

   string url = "https://api.telegram.org/bot" + InpTelegramBotToken + "/sendMessage";
   string body = "chat_id=" + UrlEncode(InpTelegramChatId) + "&text=" + UrlEncode(message);
   uchar data[];
   uchar result[];
   string headers = "Content-Type: application/x-www-form-urlencoded\r\n";
   string responseHeaders;
   StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(data) > 0)
      ArrayResize(data, ArraySize(data) - 1);

   ResetLastError();
   int code = WebRequest("POST", url, headers, 5000, data, result, responseHeaders);
   if(code == -1)
   {
      PrintFormat("Telegram WebRequest fallo. Error %d. Agregue https://api.telegram.org en URLs permitidas.", GetLastError());
      return false;
   }
   return code >= 200 && code < 300;
}

//+------------------------------------------------------------------+
//| Calculo de lotaje y ordenes                                      |
//+------------------------------------------------------------------+
double NormalizeVolume(double volume)
{
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0) step = minLot;

   volume = MathMax(minLot, MathMin(maxLot, volume));
   volume = MathFloor(volume / step) * step;
   if(volume < minLot)
      volume = minLot;

   int digits = 0;
   double probe = step;
   while(digits < 8 && MathAbs(probe - MathRound(probe)) > 0.00000001)
   {
      probe *= 10.0;
      digits++;
   }
   return NormalizeDouble(volume, digits);
}

double BrokerMinStopPoints()
{
   double stops = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double spread = SpreadPoints();
   return MathMax(stops, spread) + 2.0;
}

double BrokerFreezePoints()
{
   return (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
}

double EffectiveStopPoints(double atrValue)
{
   double atrStop = atrValue * InpAtrSlMultiplier / _Point;
   return MathMax(atrStop, BrokerMinStopPoints());
}

bool HasSufficientMargin(ENUM_SIGNAL signal, double volume, double price, string &reason)
{
   ENUM_ORDER_TYPE orderType = signal == SIGNAL_BUY ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double margin = 0.0;
   if(!OrderCalcMargin(orderType, _Symbol, volume, price, margin))
   {
      AppendReason(reason, "margen no calculable");
      return false;
   }

   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(margin > freeMargin * 0.90)
   {
      AppendReason(reason, "margen libre insuficiente");
      return false;
   }
   return true;
}

bool IsStopDistanceValid(ENUM_SIGNAL signal, double price, double sl, double tp, string &reason)
{
   double minDistance = BrokerMinStopPoints() * _Point;
   if(signal == SIGNAL_BUY)
   {
      if(price - sl < minDistance) { AppendReason(reason, "SL menor al stop level"); return false; }
      if(tp - price < minDistance) { AppendReason(reason, "TP menor al stop level"); return false; }
   }
   else
   {
      if(sl - price < minDistance) { AppendReason(reason, "SL menor al stop level"); return false; }
      if(price - tp < minDistance) { AppendReason(reason, "TP menor al stop level"); return false; }
   }
   return true;
}

double CalculateRiskVolume(double slPoints)
{
   ENUM_GROWTH_MODE mode = GetGrowthMode();
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   if(mode == MODE_CONSERVATIVE && InpUseMinLotInConservative)
      return minLot;

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double moneyRisk = balance * InpRiskPercent / 100.0;
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(slPoints <= 0.0 || tickValue <= 0.0 || tickSize <= 0.0) return 0.0;

   double lossPerLot = slPoints * _Point / tickSize * tickValue;
   if(lossPerLot <= 0.0) return 0.0;
   return NormalizeVolume(moneyRisk / lossPerLot);
}

double ExpectedRiskMoney(double volume, double slPoints)
{
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickValue <= 0.0 || tickSize <= 0.0) return DBL_MAX;
   return slPoints * _Point / tickSize * tickValue * volume;
}

bool RiskIsAllowed(double volume, double slPoints)
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double tradeRisk = ExpectedRiskMoney(volume, slPoints);
   double maxTradeRisk = balance * InpRiskPercent / 100.0;
   double maxTotalRisk = balance * InpMaxTotalRiskPercent / 100.0;
   return tradeRisk <= maxTradeRisk + 0.01 && (CurrentOpenRiskMoney() + tradeRisk) <= maxTotalRisk + 0.01;
}

void AppendReason(string &text, string item)
{
   if(item == "") return;
   if(text != "") text += " | ";
   text += item;
}

double ScoreTrend(int direction)
{
   double score = 0.0;
   double weightSum = 0.0;
   for(int i = 0; i < HORIZON_COUNT; i++)
   {
      if(!g_horizons[i].ready) continue;
      double weight = 1.0;
      if(i <= 2) weight = 1.5;
      if(i >= 8) weight = 0.8;
      weightSum += weight;
      if(g_horizons[i].trendDirection == direction)
         score += weight * (0.55 + g_horizons[i].trendStrength * 0.45);
      else if(g_horizons[i].trendDirection == 0)
         score += weight * 0.25;
   }
   return weightSum > 0.0 ? Clamp(score / weightSum * 22.0, 0.0, 22.0) : 0.0;
}

double ScoreStructure(int direction, string &reason)
{
   double score = 0.0;
   int checked = 0;
   for(int i = 7; i < HORIZON_COUNT; i++)
   {
      if(!g_horizons[i].ready) continue;
      checked++;
      if(direction > 0)
      {
         if(g_horizons[i].breakOfStructureBull) score += 1.6;
         if(g_horizons[i].changeOfCharacterBull) score += 1.2;
         if(g_horizons[i].fairValueGapBull > 0.0) score += 0.8;
         if(g_horizons[i].orderBlockBull > 0.0) score += 0.8;
      }
      else
      {
         if(g_horizons[i].breakOfStructureBear) score += 1.6;
         if(g_horizons[i].changeOfCharacterBear) score += 1.2;
         if(g_horizons[i].fairValueGapBear > 0.0) score += 0.8;
         if(g_horizons[i].orderBlockBear > 0.0) score += 0.8;
      }
   }
   if(score > 0.0)
      AppendReason(reason, direction > 0 ? "estructura alcista" : "estructura bajista");
   return Clamp(score, 0.0, 12.0);
}

double ScoreLiquidityAndZones(int direction, string &reason)
{
   double score = 0.0;
   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   ENUM_MARKET_ZONE zone = CurrentZone();

   if(direction > 0)
   {
      if(zone == ZONE_LOW) { score += 8.0; AppendReason(reason, "zona baja favorece compra"); }
      if(zone == ZONE_MID) score += 4.0;
      if(zone == ZONE_HIGH) { score -= 5.0; AppendReason(reason, "zona alta penaliza compra"); }
   }
   else
   {
      if(zone == ZONE_HIGH) { score += 8.0; AppendReason(reason, "zona alta favorece venta"); }
      if(zone == ZONE_MID) score += 4.0;
      if(zone == ZONE_LOW) { score -= 5.0; AppendReason(reason, "zona baja penaliza venta"); }
   }

   for(int i = 8; i < HORIZON_COUNT; i++)
   {
      if(!g_horizons[i].ready || g_horizons[i].atr <= 0.0) continue;
      if(direction > 0 && MathAbs(price - g_horizons[i].liquidityLow) <= g_horizons[i].atr * InpLiquidityProximityAtr)
         score += 1.2;
      if(direction < 0 && MathAbs(price - g_horizons[i].liquidityHigh) <= g_horizons[i].atr * InpLiquidityProximityAtr)
         score += 1.2;
   }

   return Clamp(score, 0.0, 12.0);
}

double ScoreVolatilityAndCosts(double atrValue, string &reason)
{
   double atrPoints = atrValue / _Point;
   double score = 0.0;
   if(atrPoints >= InpMinAtrPoints)
   {
      score += 8.0;
      AppendReason(reason, "ATR suficiente");
   }
   else
   {
      score -= 8.0;
      AppendReason(reason, "ATR bajo");
   }

   double spread = SpreadPoints();
   if(spread <= InpMaxSpreadPoints * 0.50) score += 6.0;
   else if(spread <= InpMaxSpreadPoints) score += 3.0;
   else
   {
      score -= 10.0;
      AppendReason(reason, "spread alto");
   }
   return Clamp(score, -10.0, 14.0);
}

double ScoreMomentum(int direction, double &atrValue, string &reason)
{
   double ema1, ema2, sma50_1, sma50_2, sma200_1, close1;
   if(!GetSignalData(ema1, ema2, sma50_1, sma50_2, sma200_1, atrValue, close1))
      return 0.0;

   bool trend = direction > 0 ? (sma50_1 > sma200_1 && close1 > sma200_1) : (sma50_1 < sma200_1 && close1 < sma200_1);
   bool cross = direction > 0 ? (ema2 <= sma50_2 && ema1 > sma50_1) : (ema2 >= sma50_2 && ema1 < sma50_1);
   bool aligned = direction > 0 ? (ema1 > sma50_1 && sma50_1 > sma200_1) : (ema1 < sma50_1 && sma50_1 < sma200_1);

   double score = 0.0;
   if(trend) { score += 10.0; AppendReason(reason, direction > 0 ? "tendencia MA compra" : "tendencia MA venta"); }
   if(cross) { score += 12.0; AppendReason(reason, direction > 0 ? "cruce alcista EMA/SMA" : "cruce bajista EMA/SMA"); }
   if(aligned) score += 6.0;
   return Clamp(score, 0.0, 28.0);
}

double ScoreRiskCapacity(double slPoints, string &reason)
{
   double volume = CalculateRiskVolume(slPoints);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double maxTotalRisk = balance * InpMaxTotalRiskPercent / 100.0;
   double available = MathMax(0.0, maxTotalRisk - CurrentOpenRiskMoney());
   g_decision.riskAvailableMoney = available;
   if(volume <= 0.0)
   {
      AppendReason(reason, "lote invalido");
      return -10.0;
   }
   if(!RiskIsAllowed(volume, slPoints))
   {
      AppendReason(reason, "riesgo sin capacidad");
      return -10.0;
   }
   return 12.0;
}

string BuildMarketContextText()
{
   int bull = 0, bear = 0, flat = 0;
   double strength = 0.0;
   int ready = 0;
   for(int i = 0; i < HORIZON_COUNT; i++)
   {
      if(!g_horizons[i].ready) continue;
      ready++;
      strength += g_horizons[i].trendStrength;
      if(g_horizons[i].trendDirection > 0) bull++;
      else if(g_horizons[i].trendDirection < 0) bear++;
      else flat++;
   }
   strength = ready > 0 ? strength / ready : 0.0;
   if(bull > bear && strength >= InpStrongTrendThreshold) return "Alcista fuerte";
   if(bear > bull && strength >= InpStrongTrendThreshold) return "Bajista fuerte";
   if(bull > bear) return "Alcista moderado";
   if(bear > bull) return "Bajista moderado";
   return "Lateral / mixto";
}

bool EvaluateDecision(ENUM_SIGNAL &signal, double &atrValue)
{
   signal = SIGNAL_NONE;
   g_decision.buyReason = "";
   g_decision.sellReason = "";
   g_decision.blockReason = "";
   g_decision.preferredSignal = SIGNAL_NONE;
   g_decision.buyScore = 0.0;
   g_decision.sellScore = 0.0;
   g_decision.expectedProfitMoney = 0.0;
   g_decision.currentAtr = 0.0;

   if(!RefreshMarketContext(false))
      AppendReason(g_decision.blockReason, "historico insuficiente");

   if(!CopyIndicatorValue(hAtr, 0, 1, atrValue) || atrValue <= 0.0)
   {
      AppendReason(g_decision.blockReason, "ATR no disponible");
      g_decision.eaState = "Bloqueado";
      return false;
   }

   g_decision.currentAtr = atrValue;
   double slPoints = EffectiveStopPoints(atrValue);
   string buyReason = "", sellReason = "";
   string commonReason = "";

   double baseBuy = ScoreTrend(1) + ScoreMomentum(1, atrValue, buyReason) + ScoreStructure(1, buyReason) + ScoreLiquidityAndZones(1, buyReason);
   double baseSell = ScoreTrend(-1) + ScoreMomentum(-1, atrValue, sellReason) + ScoreStructure(-1, sellReason) + ScoreLiquidityAndZones(-1, sellReason);
   double common = ScoreVolatilityAndCosts(atrValue, commonReason) + ScoreRiskCapacity(slPoints, g_decision.blockReason);

   string newsReason;
   if(IsNewsBlocked(newsReason))
   {
      common -= 30.0;
      AppendReason(g_decision.blockReason, "noticia: " + newsReason);
   }

   if(g_dailyLock)
   {
      common -= 30.0;
      AppendReason(g_decision.blockReason, "DD diario bloqueado");
   }

   if(CountOpenPositions() >= MaxPositionsForMode(GetGrowthMode()))
   {
      common -= 20.0;
      AppendReason(g_decision.blockReason, "max operaciones");
   }

   string cooldownReason = "";
   if(!EntryCooldownPassed(SIGNAL_BUY, cooldownReason))
   {
      common -= 12.0;
      AppendReason(g_decision.blockReason, cooldownReason);
   }

   g_decision.buyScore = Clamp(baseBuy + common, 0.0, 100.0);
   g_decision.sellScore = Clamp(baseSell + common, 0.0, 100.0);
   if(commonReason != "")
   {
      AppendReason(buyReason, commonReason);
      AppendReason(sellReason, commonReason);
   }
   g_decision.buyReason = buyReason == "" ? "sin confirmacion suficiente" : buyReason;
   g_decision.sellReason = sellReason == "" ? "sin confirmacion suficiente" : sellReason;
   g_decision.marketContext = BuildMarketContextText();
   g_decision.currentVolatility = g_horizons[12].ready ? g_horizons[12].volatility : 0.0;

   if(g_decision.buyScore >= InpMinDecisionScore && g_decision.buyScore > g_decision.sellScore + 4.0)
      signal = SIGNAL_BUY;
   else if(g_decision.sellScore >= InpMinDecisionScore && g_decision.sellScore > g_decision.buyScore + 4.0)
      signal = SIGNAL_SELL;

   g_decision.preferredSignal = signal;
   g_decision.signalQuality = MathMax(g_decision.buyScore, g_decision.sellScore);
   g_decision.confidence = Clamp(MathAbs(g_decision.buyScore - g_decision.sellScore), 0.0, 100.0);
   g_decision.eaState = signal == SIGNAL_NONE ? "Esperando score" : (signal == SIGNAL_BUY ? "Compra habilitada" : "Venta habilitada");

   double volume = CalculateRiskVolume(slPoints);
   if(volume > 0.0)
      g_decision.expectedProfitMoney = ExpectedRiskMoney(volume, slPoints) * InpBaseRewardRisk;

   return signal != SIGNAL_NONE && g_decision.blockReason == "";
}

bool OpenTrade(ENUM_SIGNAL signal, double atrValue)
{
   if(signal == SIGNAL_NONE) return false;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return false;

   double slPoints = EffectiveStopPoints(atrValue);
   double slDistance = slPoints * _Point;
   double volume = CalculateRiskVolume(slPoints);
   if(volume <= 0.0) return false;

   if(!RiskIsAllowed(volume, slPoints))
   {
      Print("Entrada bloqueada: riesgo calculado supera limites configurados.");
      SendTelegram("USDCAD EA: entrada bloqueada por limite de riesgo.");
      return false;
   }

   double recentAtrAvg = 0.0;
   double atrs[];
   ArrayResize(atrs, 20);
   ArraySetAsSeries(atrs, true);
   int copied = CopyBuffer(hAtr, 0, 1, 20, atrs);
   if(copied > 0)
   {
      for(int i = 0; i < copied; i++) recentAtrAvg += atrs[i];
      recentAtrAvg /= copied;
   }

   double rr = InpBaseRewardRisk;
   if(recentAtrAvg > 0.0 && atrValue >= recentAtrAvg * InpVolatileAtrMultiplier)
      rr = InpVolatileRewardRisk;

   double price = (signal == SIGNAL_BUY ? tick.ask : tick.bid);
   double sl = (signal == SIGNAL_BUY ? price - slDistance : price + slDistance);
   double tp = (signal == SIGNAL_BUY ? price + slDistance * rr : price - slDistance * rr);

   sl = NormalizeDouble(sl, _Digits);
   tp = NormalizeDouble(tp, _Digits);
   price = NormalizeDouble(price, _Digits);

   string executionBlock = "";
   if(!IsStopDistanceValid(signal, price, sl, tp, executionBlock))
   {
      Print("Entrada bloqueada: " + executionBlock);
      return false;
   }

   if(!HasSufficientMargin(signal, volume, price, executionBlock))
   {
      Print("Entrada bloqueada: " + executionBlock);
      SendTelegram("USDCAD EA: entrada bloqueada por margen.");
      return false;
   }

   Trade.SetExpertMagicNumber(InpMagicNumber);
   Trade.SetDeviationInPoints(InpSlippagePoints);
   Trade.SetTypeFillingBySymbol(_Symbol);

   bool ok = false;
   string comment = signal == SIGNAL_BUY
                    ? StringFormat("USDCAD AR v2 BUY %.0f", g_decision.buyScore)
                    : StringFormat("USDCAD AR v2 SELL %.0f", g_decision.sellScore);
   if(signal == SIGNAL_BUY)
      ok = Trade.Buy(volume, _Symbol, price, sl, tp, comment);
   else
      ok = Trade.Sell(volume, _Symbol, price, sl, tp, comment);

   if(ok && InpSendTradeOpenAlerts)
   {
      string side = (signal == SIGNAL_BUY ? "BUY" : "SELL");
      g_lastEntryTime = TimeCurrent();
      g_lastEntrySignal = signal;
      SendTelegram(StringFormat("USDCAD EA apertura %s %.2f lots @ %.5f SL %.5f TP %.5f RR %.1f",
                                side, volume, price, sl, tp, rr));
   }
   else if(ok)
   {
      g_lastEntryTime = TimeCurrent();
      g_lastEntrySignal = signal;
   }
   else if(!ok)
   {
      PrintFormat("Fallo apertura. Retcode %d: %s", Trade.ResultRetcode(), Trade.ResultRetcodeDescription());
   }

   return ok;
}

//+------------------------------------------------------------------+
//| Gestion de posiciones                                            |
//+------------------------------------------------------------------+
void ManageBreakEvenAndTrailing()
{
   double atr;
   if(!CopyIndicatorValue(hAtr, 0, 1, atr)) return;

   ENUM_GROWTH_MODE mode = GetGrowthMode();
   bool useTrailing = !InpUseAdvancedTrailingOnly || mode == MODE_ADVANCED;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!Position.SelectByIndex(i)) continue;
      if(Position.Symbol() != _Symbol || Position.Magic() != InpMagicNumber) continue;

      ulong ticket = Position.Ticket();
      long type = Position.PositionType();
      double open = Position.PriceOpen();
      double sl = Position.StopLoss();
      double tp = Position.TakeProfit();
      if(tp <= 0.0) continue;

      double current = (type == POSITION_TYPE_BUY ? tick.bid : tick.ask);
      double targetDistance = MathAbs(tp - open);
      double progress = MathAbs(current - open);
      double beTrigger = targetDistance * InpBreakEvenAtTargetPercent / 100.0;
      double spread = SpreadPoints() * _Point;
      double beExtra = InpBreakEvenExtraPoints * _Point + spread;

      double newSl = sl;
      bool shouldModify = false;

      if(progress >= beTrigger)
      {
         if(type == POSITION_TYPE_BUY)
         {
            double be = NormalizeDouble(open + beExtra, _Digits);
            if(sl < be)
            {
               newSl = be;
               shouldModify = true;
            }
         }
         else
         {
            double be = NormalizeDouble(open - beExtra, _Digits);
            if(sl == 0.0 || sl > be)
            {
               newSl = be;
               shouldModify = true;
            }
         }
      }

      if(useTrailing && progress > atr * InpAtrTrailingMultiplier)
      {
         double trailDistance = atr * InpAtrTrailingMultiplier;
         if(type == POSITION_TYPE_BUY)
         {
            double trailSl = NormalizeDouble(current - trailDistance, _Digits);
            if(trailSl > newSl && trailSl > open)
            {
               newSl = trailSl;
               shouldModify = true;
            }
         }
         else
         {
            double trailSl = NormalizeDouble(current + trailDistance, _Digits);
            if((newSl == 0.0 || trailSl < newSl) && trailSl < open)
            {
               newSl = trailSl;
               shouldModify = true;
            }
         }
      }

      if(shouldModify)
      {
         double freeze = BrokerFreezePoints() * _Point;
         if(freeze > 0.0 && MathAbs(current - newSl) <= freeze)
            continue;

         if(!Trade.PositionModify(ticket, NormalizeDouble(newSl, _Digits), tp))
            PrintFormat("Fallo modificando SL ticket %I64u. Retcode %d: %s",
                        ticket, Trade.ResultRetcode(), Trade.ResultRetcodeDescription());
      }
   }
}

//+------------------------------------------------------------------+
//| Estadisticas                                                     |
//+------------------------------------------------------------------+
double DealsProfitSince(datetime fromTime)
{
   double profit = 0.0;
   if(!HistorySelect(fromTime, TimeCurrent())) return 0.0;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      if(HistoryDealGetString(ticket, DEAL_SYMBOL) != _Symbol) continue;
      if((ulong)HistoryDealGetInteger(ticket, DEAL_MAGIC) != InpMagicNumber) continue;
      profit += HistoryDealGetDouble(ticket, DEAL_PROFIT)
              + HistoryDealGetDouble(ticket, DEAL_SWAP)
              + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   }
   return profit;
}

void RefreshStats()
{
   g_stats.wins = 0;
   g_stats.losses = 0;
   g_stats.trades = 0;
   g_stats.grossProfit = 0.0;
   g_stats.grossLoss = 0.0;

   datetime from = TimeCurrent() - 365 * 86400;
   if(HistorySelect(from, TimeCurrent()))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0) continue;
         if(HistoryDealGetString(ticket, DEAL_SYMBOL) != _Symbol) continue;
         if((ulong)HistoryDealGetInteger(ticket, DEAL_MAGIC) != InpMagicNumber) continue;
         if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;

         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                       + HistoryDealGetDouble(ticket, DEAL_SWAP)
                       + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
         g_stats.trades++;
         if(profit >= 0.0)
         {
            g_stats.wins++;
            g_stats.grossProfit += profit;
         }
         else
         {
            g_stats.losses++;
            g_stats.grossLoss += MathAbs(profit);
         }
      }
   }

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_stats.peakEquity <= 0.0 || equity > g_stats.peakEquity)
      g_stats.peakEquity = equity;

   double dd = g_stats.peakEquity - equity;
   if(dd > g_stats.maxDrawdownMoney)
      g_stats.maxDrawdownMoney = dd;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.day = 1;
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   g_stats.monthlyProfit = DealsProfitSince(StructToTime(dt));

   dt.mon = 1;
   dt.day = 1;
   g_stats.annualProfit = DealsProfitSince(StructToTime(dt));
}

double ProfitFactor()
{
   if(g_stats.grossLoss <= 0.0)
      return (g_stats.grossProfit > 0.0 ? 99.0 : 0.0);
   return g_stats.grossProfit / g_stats.grossLoss;
}

//+------------------------------------------------------------------+
//| Panel                                                            |
//+------------------------------------------------------------------+
void EnsurePanelLabel(string name, int row, string text, color clr)
{
   if(ObjectFind(0, name) < 0)
   {
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, InpPanelCorner);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, InpPanelX + 10);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, InpPanelY + 10 + row * 17);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0, name, OBJPROP_FONT, "Consolas");
   }
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
}

void DrawPanel()
{
   if(!InpShowPanel) return;

   string bg = "USDCAD_EA_PANEL_BG";
   if(ObjectFind(0, bg) < 0)
   {
      ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, bg, OBJPROP_CORNER, InpPanelCorner);
      ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, InpPanelX);
      ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, InpPanelY);
      ObjectSetInteger(0, bg, OBJPROP_XSIZE, 610);
      ObjectSetInteger(0, bg, OBJPROP_YSIZE, 625);
      ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, InpPanelBgColor);
      ObjectSetInteger(0, bg, OBJPROP_COLOR, InpPanelBgColor);
      ObjectSetInteger(0, bg, OBJPROP_BACK, false);
   }

   RefreshStats();
   datetime newsTime;
   string news = NextHighImpactNewsText(newsTime);
   int minutesToNews = newsTime > 0 ? (int)MathRound((double)(newsTime - TimeCurrent()) / 60.0) : -1;
   g_decision.nextNews = news;
   g_decision.minutesToNews = minutesToNews;
   double dailyProfit = DealsProfitSince(g_currentDayStart);
   double weeklyProfit = DealsProfitSince(g_currentWeekStart);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double dd = g_dayStartEquity > 0.0 ? (g_dayStartEquity - equity) / g_dayStartEquity * 100.0 : 0.0;
   double riskPct = AccountInfoDouble(ACCOUNT_BALANCE) > 0.0 ? CurrentOpenRiskMoney() / AccountInfoDouble(ACCOUNT_BALANCE) * 100.0 : 0.0;
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double maxRiskMoney = balance * InpMaxTotalRiskPercent / 100.0;
   double riskAvailable = MathMax(0.0, maxRiskMoney - CurrentOpenRiskMoney());
   string marketState = g_dailyLock ? "Bloqueado DD diario" : (IsSpreadAcceptable() ? "Operable" : "Spread alto");
   ENUM_GROWTH_MODE mode = GetGrowthMode();
   string lastAnalysis = g_decision.lastAnalysisTime > 0 ? TimeToString(g_decision.lastAnalysisTime, TIME_DATE | TIME_SECONDS) : "sin analisis";

   EnsurePanelLabel("USDCAD_EA_L0", 0,  "USDCAD Adaptive Risk EA v2.00", clrAqua);
   EnsurePanelLabel("USDCAD_EA_L1", 1,  StringFormat("Balance: %.2f | Equity: %.2f", AccountInfoDouble(ACCOUNT_BALANCE), equity), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L2", 2,  StringFormat("DD diario: %.2f%% | DD max: %.2f", dd, g_stats.maxDrawdownMoney), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L3", 3,  StringFormat("Ganancia diaria: %.2f | semanal: %.2f", dailyProfit, weeklyProfit), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L4", 4,  StringFormat("Abiertas: %d/%d | Riesgo actual: %.2f%% | disponible: %.2f", CountOpenPositions(), MaxPositionsForMode(mode), riskPct, riskAvailable), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L5", 5,  StringFormat("Spread: %.1f pts | Mercado: %s", SpreadPoints(), marketState), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L6", 6,  StringFormat("Estado: %s | Modo: %s | Zona: %s", g_decision.eaState, ModeToString(mode), ZoneToString(CurrentZone())), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L7", 7,  StringFormat("Contexto: %s | Velas analizadas: %d", g_decision.marketContext, g_decision.totalCandles), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L8", 8,  StringFormat("Ultimo analisis: %s", lastAnalysis), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L9", 9,  StringFormat("Score BUY: %.1f | SELL: %.1f | minimo: %.1f", g_decision.buyScore, g_decision.sellScore, InpMinDecisionScore), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L10", 10, StringFormat("Calidad: %.1f | Confianza: %.1f | Beneficio esperado: %.2f", g_decision.signalQuality, g_decision.confidence, g_decision.expectedProfitMoney), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L11", 11, StringFormat("ATR: %.1f pts | Volatilidad 4H: %.4f%%", g_decision.currentAtr / _Point, g_decision.currentVolatility), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L12", 12, StringFormat("Noticia: %s | min: %d", news, minutesToNews), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L13", 13, StringFormat("Wins/Losses: %d/%d | PF: %.2f | Mensual: %.2f | Anual: %.2f", g_stats.wins, g_stats.losses, ProfitFactor(), g_stats.monthlyProfit, g_stats.annualProfit), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L14", 14, HorizonLine(0), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L15", 15, HorizonLine(1), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L16", 16, HorizonLine(2), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L17", 17, HorizonLine(3), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L18", 18, HorizonLine(4), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L19", 19, HorizonLine(5), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L20", 20, HorizonLine(6), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L21", 21, HorizonLine(7), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L22", 22, HorizonLine(8) + " | " + HorizonLine(9), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L23", 23, HorizonLine(10) + " | " + HorizonLine(11), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L24", 24, HorizonLine(12) + " | " + HorizonLine(13), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L25", 25, HorizonLine(14) + " | " + HorizonLine(15), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L26", 26, "Compra: " + g_decision.buyReason, InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L27", 27, "Venta: " + g_decision.sellReason, InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L28", 28, "Bloqueo: " + (g_decision.blockReason == "" ? "ninguno" : g_decision.blockReason), InpPanelTextColor);
   EnsurePanelLabel("USDCAD_EA_L29", 29, StringFormat("TP RR base %.1f | volatil %.1f", InpBaseRewardRisk, InpVolatileRewardRisk), InpPanelTextColor);
}

void DeletePanel()
{
   ObjectDelete(0, "USDCAD_EA_PANEL_BG");
   for(int i = 0; i <= 29; i++)
      ObjectDelete(0, "USDCAD_EA_L" + IntegerToString(i));
}

//+------------------------------------------------------------------+
//| Resumenes y transacciones                                        |
//+------------------------------------------------------------------+
void SendPeriodicSummaries()
{
   datetime now = TimeCurrent();
   MqlDateTime dt;
   TimeToStruct(now, dt);

   if(InpSendDailySummary && DayStart(now) != DayStart(g_lastDailySummary) && dt.hour >= 23)
   {
      g_lastDailySummary = now;
      SendTelegram(StringFormat("Resumen diario USDCAD EA: P/L %.2f, abiertas %d, PF %.2f, DD max %.2f",
                                DealsProfitSince(g_currentDayStart), CountOpenPositions(), ProfitFactor(), g_stats.maxDrawdownMoney));
   }

   if(InpSendWeeklySummary && WeekStart(now) != WeekStart(g_lastWeeklySummary) && dt.day_of_week == 5 && dt.hour >= 23)
   {
      g_lastWeeklySummary = now;
      SendTelegram(StringFormat("Resumen semanal USDCAD EA: P/L %.2f, trades %d, wins %d, losses %d, PF %.2f",
                                DealsProfitSince(g_currentWeekStart), g_stats.trades, g_stats.wins, g_stats.losses, ProfitFactor()));
   }
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(!InpUseTelegram || !InpSendTradeCloseAlerts) return;
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetString(trans.deal, DEAL_SYMBOL) != _Symbol) return;
   if((ulong)HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagicNumber) return;
   if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;

   double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                 + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                 + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
   SendTelegram(StringFormat("USDCAD EA cierre: deal %I64u P/L %.2f", trans.deal, profit));
}

//+------------------------------------------------------------------+
//| Ciclo principal                                                  |
//+------------------------------------------------------------------+
int OnInit()
{
   if(_Symbol != InpAllowedSymbol)
      PrintFormat("Advertencia: cargado en %s, este EA solo opera %s.", _Symbol, InpAllowedSymbol);

   Trade.SetExpertMagicNumber(InpMagicNumber);

   hEmaFast = iMA(_Symbol, InpSignalTimeframe, InpEmaFastPeriod, 0, MODE_EMA, PRICE_CLOSE);
   hSmaMid  = iMA(_Symbol, InpSignalTimeframe, InpSmaMidPeriod, 0, MODE_SMA, PRICE_CLOSE);
   hSmaSlow = iMA(_Symbol, InpSignalTimeframe, InpSmaSlowPeriod, 0, MODE_SMA, PRICE_CLOSE);
   hAtr     = iATR(_Symbol, InpSignalTimeframe, InpAtrPeriod);

   if(hEmaFast == INVALID_HANDLE || hSmaMid == INVALID_HANDLE || hSmaSlow == INVALID_HANDLE || hAtr == INVALID_HANDLE)
   {
      Print("No se pudieron crear handles de indicadores.");
      return INIT_FAILED;
   }

   g_currentDayStart = DayStart(TimeCurrent());
   g_currentWeekStart = WeekStart(TimeCurrent());
   g_dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_weekStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_stats.peakEquity = AccountInfoDouble(ACCOUNT_EQUITY);

   InitializeHorizons();
   RefreshHistoricalZones(true);
   RefreshMarketContext(true);
   double initAtr = 0.0;
   ENUM_SIGNAL initSignal = SIGNAL_NONE;
   EvaluateDecision(initSignal, initAtr);
   EventSetTimer(15);
   DrawPanel();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(hEmaFast != INVALID_HANDLE) IndicatorRelease(hEmaFast);
   if(hSmaMid != INVALID_HANDLE) IndicatorRelease(hSmaMid);
   if(hSmaSlow != INVALID_HANDLE) IndicatorRelease(hSmaSlow);
   if(hAtr != INVALID_HANDLE) IndicatorRelease(hAtr);
   DeletePanel();
}

void OnTimer()
{
   RefreshPeriodAnchors();
   RefreshHistoricalZones(false);
   RefreshMarketContext(false);
   double timerAtr = 0.0;
   ENUM_SIGNAL timerSignal = SIGNAL_NONE;
   EvaluateDecision(timerSignal, timerAtr);
   DrawPanel();
   SendPeriodicSummaries();
}

void OnTick()
{
   if(!IsAllowedEnvironment())
   {
      return;
   }

   RefreshPeriodAnchors();
   ManageBreakEvenAndTrailing();

   if(!IsNewBar())
   {
      return;
   }

   RefreshHistoricalZones(false);
   RefreshMarketContext(true);

   if(!InpAllowNewEntries || g_dailyLock) return;
   if(!IsSpreadAcceptable()) return;

   string newsReason;
   if(IsNewsBlocked(newsReason))
   {
      if(InpSendNewsTelegramAlert && TimeCurrent() - g_lastNewsAlert > 1800)
      {
         g_lastNewsAlert = TimeCurrent();
         SendTelegram("USDCAD EA: entradas bloqueadas por noticia " + newsReason);
      }
      return;
   }

   ENUM_GROWTH_MODE mode = GetGrowthMode();
   int maxAllowed = MaxPositionsForMode(mode);
   int targetOpen = TargetPositionsForMode(mode);
   int currentOpen = CountOpenPositions();
   if(currentOpen >= maxAllowed) return;

   double atrValue = 0.0;
   ENUM_SIGNAL signal = SIGNAL_NONE;
   if(!EvaluateDecision(signal, atrValue)) return;
   if(!ZoneAllowsSignal(signal, atrValue)) return;

   int desiredOpen = InpFillTargetPositions ? targetOpen : MathMin(currentOpen + 1, targetOpen);
   int entriesToOpen = MathMax(1, desiredOpen - currentOpen);
   entriesToOpen = MathMin(entriesToOpen, maxAllowed - currentOpen);

   for(int i = 0; i < entriesToOpen; i++)
   {
      if(CountOpenPositions() >= maxAllowed) break;
      if(!OpenTrade(signal, atrValue)) break;
   }
}

//+------------------------------------------------------------------+
//| Notas de optimizacion                                            |
//| Optimizar: RiskPercent, MaxDailyDrawdownPercent, MaxSpreadPoints,|
//| MinAtrPoints, AtrSlMultiplier, AtrTrailingMultiplier,            |
//| VolatileAtrMultiplier, BaseRewardRisk, VolatileRewardRisk,       |
//| NewsBlockMinutesBefore/After, ZoneBiasFactor.                    |
//+------------------------------------------------------------------+
