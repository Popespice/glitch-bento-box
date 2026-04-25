import DotMatrix from './DotMatrix.jsx'

export default function WeatherTile() {
  const temp = 58
  const condition = 'PARTLY CLOUDY'
  const humidity = 64
  const wind = 'NW 7 MPH'

  return (
    <div className="tile weather-tile">
      <span className="tile-label">WEATHER</span>
      <div className="tile-value-row">
        <div className="tile-value-matrix">
          <DotMatrix text={`${temp}.`} />
        </div>
        <span className="tile-value-unit">°F</span>
      </div>
      <div className="tile-meta">
        <span className="tile-meta-name">Washington, NJ</span>
        <span className="tile-meta-line">{condition} / {humidity}%</span>
        <span className="tile-meta-line">WIND {wind}</span>
      </div>
    </div>
  )
}
