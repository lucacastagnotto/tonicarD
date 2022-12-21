// geometry library: https://github.com/HarryStevens/geometric

const lineWidth = 1 * devicePixelRatio,
	resizeRadius = 8 * devicePixelRatio;

// geometric functions
function angleToDegrees (angle) {
	return angle * 180 / Math.PI;
}

function angleToRadians(angle){
	return angle / 180 * Math.PI;
}

function pointTranslate(point, angle, distance){
	const r = angleToRadians(angle);
	return {x: point.x + distance * Math.cos(r), y: point.y + distance * Math.sin(r)};
}

function calcCentroid(corners){
	let a = 0, x = 0, y = 0, l = corners.length;

	for (let i = 0; i < l; i++) {
		const s = i === l - 1 ? 0 : i + 1,
			v0 = corners[i],
			v1 = corners[s],
			f = (v0.x * v1.y) - (v1.x * v0.y);

		a += f;
		x += (v0.x + v1.x) * f;
		y += (v0.y + v1.y) * f;
	}

	const d = a * 3;

	let c = {
		x: x / d,
		y: y / d
	};

	return c;
}

function distance(p1, p2) {
	return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// other functions
function colorConverter(color) {
	var colors = {
		"green": [0, 128, 0],
		"blue": [0, 0, 255],
		"red": [255, 0, 0],
		"black": [0, 0, 0]
	}
	return colors[color];
}

class Quad {
	constructor(id, corners, color, label) {
		this._id = id;
		this._corners = corners;
		this._color = color;
		this._label = label;
		this._centroid = calcCentroid(corners);
	}

	// static quadFromJSON(id, x, y, corners) {
	//   return new Quad(id, x, y, corners)
	// }

	// get x() {
	//   return this._x;
	// }

	// get y() {
	//   return this._y;
	// }

	get corners() {
		return this._corners
	}

	get id() {
		return this._id
	}

	get label() {
		return this._label
	}

	get color() {
		return this._color
	}

	get centroid() {
		return this._centroid
	}

	set label(label) {
		this._label = label
	}

	set color(color) {
		this._color = color
	}

	set updateCorners(updatedCorners) {
		this._corners = updatedCorners;
		this._centroid = calcCentroid(this._corners);
	}

	getArea() {
		var a = 0;
		for (var i = 0, l = this._corners.length; i < l; i++) {
			const v0 = this._corners[i],
				v1 = this._corners[i === l - 1 ? 0 : i + 1];

			a += v0.x * v1.y;
			a -= v1.x * v0.y;
		}
		return a / 2;
	}

	isPointInside(point) {
		var x = point.x,
			y = point.y,
			inside = false;

		for (var i = 0, j = 3; i < 4; j = i++) {
			var xi = this._corners[i].x,
				yi = this._corners[i].y,
				xj = this._corners[j].x,
				yj = this._corners[j].y;

			if (yi > y != yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
				inside = !inside;
			}
		}

		return inside;
	}

	closeToCorner(point) {
		// return false or index-corner + 1 (avoid to return 0!)
		var close = false;
		for (const [idx, corner] of this._corners.entries()) {
			if(distance(point, corner) <= resizeRadius) {
				close = idx + 1;
				break;
			}
		}
		return close
	}

	resizeCorner(p1, p2, p3, bigger) {
		var a1 = angleToDegrees(Math.atan2(p2.y - p1.y, p2.x - p1.x));
		var a3 = angleToDegrees(Math.atan2(p2.y - p3.y, p2.x - p3.x));
		var bisec = (a1 + a3) / 2;
		if(bisec < 0) {
			bisec = 180 + bisec;
		}

		var distance = 10;
		var new_corner = pointTranslate(p2, bisec, distance);
		if((this.isPointInside(new_corner) && bigger) || (!this.isPointInside(new_corner) && !bigger)) {
			new_corner = pointTranslate(p2, bisec + 180, distance);
		}
		return new_corner;
	}

	closeToSegmentMidpoint(point) {

		function pDistance(x, y, x1, y1, x2, y2) {
			// distance between a Point and a Line
			var A = x - x1;
			var B = y - y1;
			var C = x2 - x1;
			var D = y2 - y1;

			var dot = A * C + B * D;
			var len_sq = C * C + D * D;
			var param = -1;
			if (len_sq != 0) //in case of 0 length line
					param = dot / len_sq;

			var xx, yy;

			if (param < 0) {
				xx = x1;
				yy = y1;
			}
			else if (param > 1) {
				xx = x2;
				yy = y2;
			}
			else {
				xx = x1 + param * C;
				yy = y1 + param * D;
			}

			var dx = x - xx;
			var dy = y - yy;
			return Math.sqrt(dx * dx + dy * dy);
		}

		var close = false;
		var axis = undefined;
		var angles = [];
		for (var i = 0, j = 3; i < 4; j = i++) {
			var xi = this._corners[i].x,
				yi = this._corners[i].y,
				xj = this._corners[j].x,
				yj = this._corners[j].y,
				midpoint = {x: (xi + xj) / 2, y: (yi + yj) / 2};

			//if (pDistance(point.x, point.y, xi, yi, xj, yj) <= resizeRadius) {
			if (distance(point, midpoint) <= resizeRadius) {
				close = true;
				var value = Math.abs(angleToDegrees(Math.atan2(yj - yi, xj - xi)));
				if ((value >= 0 && value <= 45) || (value >= 135 && value <= 180)) {
					axis = "y";
				}
				else {
					axis = "x";
				}
				angles.push(i, j);
				break;
			}
		}
		var returnValue = {
			bool: close,
			axis: axis,
			angles: angles
		};
		return returnValue;
	}

	draw(ctx, selectedId){
		// draw quad
		ctx.lineWidth = lineWidth;
		ctx.strokeStyle = this._color;
		ctx.beginPath();
		ctx.moveTo(this._corners[0].x, this._corners[0].y);
		ctx.lineTo(this._corners[1].x, this._corners[1].y);
		ctx.lineTo(this._corners[2].x, this._corners[2].y);
		ctx.lineTo(this._corners[3].x, this._corners[3].y);
		ctx.closePath();
		ctx.stroke();
		// fill if selected
		if(selectedId == this._id) {
			let rgb = colorConverter(this._color);
			let rgba = "rgba(" + String(rgb[0]) + ", " + String(rgb[1]) + ", " + String(rgb[2]) + ", 0.2)";
			ctx.fillStyle = rgba;
			ctx.fill();
		}

		// draw resize points
		ctx.fillStyle = this._color;
		for (var i = 0, j = 3; i < 4; j = i++) {
			// draw segment middle point
			const midPoint = {
				x: (this._corners[i].x + this._corners[j].x) / 2,
				y: (this._corners[i].y + this._corners[j].y) / 2
			}
			ctx.beginPath();
			ctx.arc(midPoint.x, midPoint.y, 7, 0, 2 * Math.PI);
			ctx.closePath();
			ctx.fill();
			// draw corner
			ctx.beginPath();
			ctx.arc(this._corners[i].x, this._corners[i].y, 7, 0, 2 * Math.PI);
			ctx.closePath();
			ctx.fill();
		}
	}
}

