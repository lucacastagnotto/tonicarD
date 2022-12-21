from flask import Flask, request
from flask_cors import CORS

import argparse, os, io, json, re, numpy, time, random, copy, datetime, unicodedata as ud

from operator import itemgetter

from os import listdir
from os.path import isfile, join

from google.cloud import vision
from google.cloud import vision_v1
from google.cloud.vision_v1 import AnnotateImageResponse

from PIL import Image, ImageDraw

from shapely import geometry
from shapely.geometry import Polygon, LineString, Point

from waitress import serve

app = Flask(__name__)
CORS(app)

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "./cred/googleCloudServiceAccount.json"

# global vars

black_percentage = 3
centroids = []
maxShapes = {}
imWidth = 0
imHeight = 0

# functions
def set_image_properties(image_file):
	# set image width and height
	im = Image.open(image_file)
	width, height = im.size
	# set centroids
	initialCentroids = [(1055.655, 1070.19), (2597.805, 2012.7050000000002), (2709.0300000000007, 2728.35), (648.6850000000001, 2626.7200000000003)]
	avgWidth = 4369
	avgHeight = 6027
	new_centroids = []
	for c in initialCentroids:
		new_x = c[0] * width / avgWidth
		new_y = c[1] * height / avgHeight
		new_centroids.append(Point(new_x, new_y))
	global centroids
	centroids = new_centroids
	global imWidth
	imWidth = width
	global imHeight
	imHeight = height
	# set max_shapes
	initialShapes = {
		"Autore": [(0, 360), (3243, 360), (3243, 1661), (0, 1661)],
		"Titolo": [(24, 483), (4383, 483), (4383, 4150), (1305, 4150), (1305, 2273), (24, 2273)],
		"Note": [(1110, 1137), (4286, 1137), (4286, 4700), (1110, 4700)],
		"Collocazione": [(0, 1702), (1603, 1702), (1603, 3144), (0, 3144)]
	}
	for label in initialShapes:
		new_vects = []
		for vect in initialShapes[label]:
			new_x = vect[0] * width / avgWidth
			new_y = vect[1] * height / avgHeight
			new_vects.append((new_x, new_y))
		global maxShapes
		maxShapes[label] = Polygon(new_vects)

def drawBoxes(image_file, json_file, name_file):
	f = open(json_file)
	response = json.load(f)
	im = Image.open(image_file)

	for page in response["fullTextAnnotation"]["pages"]:
		for block in page["blocks"]:
			for paragraph in block["paragraphs"]:
				vects = paragraph["boundingBox"]["vertices"]
				draw = ImageDraw.Draw(im)
				draw.polygon([
					vects[0]["x"], vects[0]["y"],
					vects[1]["x"], vects[1]["y"],
					vects[2]["x"], vects[2]["y"],
					vects[3]["x"], vects[3]["y"]], None, "blue", 5)

	new_name_file = name_file + ".jpg"
	new_file_path = join(os.getcwd(), "googleAnnotations", new_name_file)
	im.save(new_file_path, "JPEG")

def imageManipulation(card):
	name_image = card + ".jpg"
	name_json = card + ".json"
	im_file = join("all_caronti_cards", name_image)
	json_file = join("googleAnnotations", name_json)
	set_image_properties(im_file)
	boxes = get_boxes(json_file, card)
	boxes = filter_boxes(boxes)
	boxes = identify_collocation_box(boxes)
	boxes, conn_boxes = connect_boxes(boxes)
	boxes = handle_connected_boxes(boxes, conn_boxes, im_file)
	boxes = set_labels(boxes)
	draw_final(boxes, im_file, card)
	generate_json(boxes, card)

	return json.dumps("fatto")

def intersection_empty(box, rightBox, image_file):
	final_polygon = box['shape'].intersection(rightBox['shape'])
	if(final_polygon.is_empty):
		return True
	newIm = crop_images(image_file, final_polygon)
	if(get_black_perc(newIm) < black_percentage):
		return True
	else:
		return False

def difference_empty(box, graph, image_file):
	polygons = []
	returnValue = True
	for adjacent_box in box['info']['n_conn']:
		polygons.append(next(x for x in graph if int(adjacent_box) == int(x['id']))['shape'])
	final_polygon = box['shape']
	for p in polygons:
		final_polygon = final_polygon.difference(p)
	if(final_polygon.is_empty):
		return returnValue
	# final_polygon could have become a MultiPolygon
	if(final_polygon.geom_type == "MultiPolygon"):
		for polygon in final_polygon.geoms:
			newIm = crop_images(image_file, polygon)
			if(get_black_perc(newIm) >= black_percentage):
				returnValue = False
				break
	else:
		newIm = crop_images(image_file, final_polygon)
		if(get_black_perc(newIm) >= black_percentage):
			returnValue = False
		else:
			returnValue = True # shouldn't matter
	return returnValue

def crop_images(image_file, final_polygon):
	# read image as RGB and add alpha (transparency)
	im = Image.open(image_file).convert("RGBA")

	# convert to numpy (for convenience)
	imArray = numpy.asarray(im)

	# create mask
	polygon = list(final_polygon.exterior.coords)
	maskIm = Image.new('L', (imArray.shape[1], imArray.shape[0]), 0)
	ImageDraw.Draw(maskIm).polygon(polygon, outline=1, fill=1)
	mask = numpy.array(maskIm)

	# assemble new image (uint8: 0-255)
	newImArray = numpy.empty(imArray.shape,dtype='uint8')

	# colors (three first columns, RGB)
	newImArray[:,:,:3] = imArray[:,:,:3]

	# transparency (4th column)
	newImArray[:,:,3] = mask*255

	# back to Image from numpy
	newIm = Image.fromarray(newImArray, "RGBA")

	return newIm

def crop_images2(image_file, final_polygon):
	original = Image.open(image_file)
	mask = Image.new("L", original.size, 0)
	draw = ImageDraw.Draw(mask)
	polygon = list(final_polygon.exterior.coords)
	draw.polygon(polygon, fill=255, outline=None)
	black =  Image.new("RGB", original.size, 0)
	result = Image.composite(original, black, mask)

	return result

def crop_images3(image_file, final_polygon):
	# read image as RGB (without alpha)
	img = Image.open(image_file).convert("RGB")

	# convert to numpy (for convenience)
	img_array = numpy.asarray(img)

	# create mask
	polygon = list(final_polygon.exterior.coords)

	# create new image ("1-bit pixels, black and white", (width, height), "default color")
	mask_img = Image.new('1', (img_array.shape[1], img_array.shape[0]), 0)

	ImageDraw.Draw(mask_img).polygon(polygon, outline=1, fill=1)
	mask = numpy.array(mask_img)

	# assemble new image (uint8: 0-255)
	new_img_array = numpy.empty(img_array.shape, dtype='uint8')

	# copy color values (RGB)
	new_img_array[:,:,:3] = img_array[:,:,:3]

	# filtering image by mask
	new_img_array[:,:,0] = new_img_array[:,:,0] * mask
	new_img_array[:,:,1] = new_img_array[:,:,1] * mask
	new_img_array[:,:,2] = new_img_array[:,:,2] * mask

	# back to Image from numpy
	newIm = Image.fromarray(new_img_array, "RGB")
	return newIm

def get_black_perc(image_file):
	im = image_file
	tmp_colors = im.getcolors(im.size[0]*im.size[1]) # alpha values always 0 or 255
	colors = []
	for color in tmp_colors:
		if(color[1][3] > 0):
			colors.append(color)

	def sum_rgb(rgb):
		return rgb[0] + rgb[1] + rgb[2]

	treshold = 140
	colors_under_tres = 0
	total_pixels = 0
	for color in colors:
		# color (N_of_pixels_of_this_color, (r, g, b, a))
		total_pixels += color[0]
		sum_value = sum_rgb(color[1])
		if(sum_value < treshold):
			colors_under_tres += color[0]
	
	percentage = colors_under_tres*100/total_pixels
	
	return percentage

def get_boxes(json_file, name_file):
	f = open(json_file)
	response = json.load(f)
	id_counter = 1
	boxes = []
	for page in response['fullTextAnnotation']['pages']:
		for block in page['blocks']:
			for paragraph in block['paragraphs']:
				vects = paragraph['boundingBox']['vertices']
				text = ""
				for word in paragraph['words']:
					for symbol in word['symbols']:
						text += symbol['text']
					text += " "
				text = re.sub("\s(?=[.;:,!?@_*])", "", text) # delete spaces between words and punctuation marks
				if(text[-1] == " "):
					text = text[:-1]
				if(text[0] == " "):
					text = text[1:]
				new_info = {
					"text": text,
					"n_conn": []
				}
				# avoid negative coords
				for v in vects:
					v['x'] = max(0, v['x'])
					v['y'] = max(0, v['y'])
				new_polygon = Polygon([(vects[0]['x'], vects[0]['y']), (vects[1]['x'], vects[1]['y']), (vects[2]['x'], vects[2]['y']), (vects[3]['x'], vects[3]['y'])])
				new_obj = {
					"id": id_counter,
					"shape": new_polygon,
					"label": "",
					"info": new_info
				}
				boxes.append(new_obj)
				id_counter += 1
	return boxes

def filter_boxes(boxes):

	def has_letters(word):
		returnValue = False
		for char in word:
			if(char.isalpha()):
				returnValue = True
				break
		return returnValue

	new_boxes = []
	for box in boxes:
		text = box['info']['text']
		"""
		if(not filter_western_chars(text)):
			# delete non western chars
			continue
		"""
		if(not has_letters(text) and len(text) < 4):
			continue
		new_boxes.append(box)
	return new_boxes

def identify_collocation_box(boxes):
	new_maxId = max([box['id'] for box in boxes]) + 1
	box_to_add = []
	for box in boxes:
		vects = list(box['shape'].exterior.coords)
		flag_topLeft = False
		flag_Bottom = True
		flag_Right = False
		oldRight = 0
		for v in vects:
			if(v[0] < 90 and v[1] > 1700):
				flag_topLeft = True
			if(v[1] > 3150):
				flag_Bottom = False
			if(v[0] > 1605):
				flag_Right = True
				if(v[0] > oldRight):
					oldRight = v[0]
		if(flag_Bottom and flag_topLeft and flag_Right):
			# elimina testo appartenente ad un'altra box
			reg = "(Rar\w)+.+?(\d)+"
			txt = box['info']['text']
			coll_text = ""
			new_box_text = ""
			reg_match = re.search(reg, txt)
			flag_txt_found = False

			if(reg_match):
				flag_txt_found = True
				idx_end = reg_match.span()[1]
				coll_text = txt[0:idx_end]
				new_box_text = txt[idx_end:]
				box['info']['text'] = coll_text
				
			else:
				count_dots = 0
				coll_text = ""
				idx_new_word = 0
				for idx, char in enumerate(txt):
					if(char == "."):
						count_dots += 1
						if(count_dots == 4):
							coll_text = txt[0:idx+1]
							remaining_txt = txt[idx+1:]
							if(len(remaining_txt)):
								reg2 = "\s*\w{1,2}\."
								reg2_match = re.match(reg2, remaining_txt)
								if(reg2_match):
									last_idx = reg2_match.span()[1]
									coll_text += remaining_txt[0:last_idx]
									remaining_txt = remaining_txt[last_idx:]
								if(len(remaining_txt) > 0):
									if(remaining_txt[-1] == " "):
										remaining_txt = remaining_txt[:-1]
									if(remaining_txt[0] == " "):
										remaining_txt = remaining_txt[1:]	
							new_box_text = remaining_txt
							flag_txt_found = True
							box['info']['text'] = coll_text
							print("Stringa: " + txt)
							print("coll_text: " + coll_text)
							print("new_box_text: " + new_box_text)
							break

			if(not flag_txt_found):
				print("Unable to update text")
				# do an approximation
			
			# ridisegna box
			box["shape"] = Polygon([vects[0], (1300, vects[0][1]), (1300, vects[3][1]), vects[3]])

			# disegna box con testo scartato
			new_box_vects = copy.deepcopy(vects)
			new_polygon = Polygon([(1305, vects[0][1]), vects[1], vects[2], (1305, vects[2][1])])
			new_box = {
			'id': new_maxId,
			'shape': new_polygon,
			'info': {
				'text': new_box_text,
				'n_conn': 0
				}
			} # should add "label": ""
			box_to_add.append(new_box)
			new_maxId += 1
	for box in box_to_add:
		boxes.append(box)

	return boxes

def get_topSide(coords):
	del coords[-1]
	yVects = [xy[1] for xy in coords]
	maxY = min(yVects)
	maxIndex = yVects.index(maxY)
	yVects.remove(maxY)
	max2Y = min(yVects)
	max2Index = yVects.index(max2Y)
	if(max2Index >= maxIndex):
		max2Index += 1
	xy1 = coords[maxIndex]
	xy2 = coords[max2Index]
	topSide = LineString([xy1, xy2])
	return topSide

def get_leftSide(coords):
	del coords[-1]
	xVects = [xy[0] for xy in coords]
	maxX = min(xVects)
	maxIndex = xVects.index(maxX)
	xVects.remove(maxX)
	max2X = min(xVects)
	max2Index = xVects.index(max2X)
	if(max2Index >= maxIndex):
		max2Index += 1
	xy1 = coords[maxIndex]
	xy2 = coords[max2Index]
	leftSide = LineString([xy1, xy2])
	return leftSide

def lookfor_better_sides(corner, opposite, graph, maxXY):
	# corner: vect both maxLeft/Right and maxUp/Down
	# opposite[]: 2 max vects on the opposite side of corner (on the X or Y)
	# graph[]: list of each box
	# maxXY[]: 2 max vects of opposite corner
	tmpSide0 = LineString([corner, opposite[0]])
	tmpSide1 = LineString([corner, opposite[1]])
	crosses0 = False
	crosses1 = False
	for box in graph:
		if(box['shape'].intersects(tmpSide0)):
			intersectionPoints = list(box['shape'].intersection(tmpSide0).coords)
			endpoints = tmpSide0.boundary
			first = endpoints.geoms[0]
			last = endpoints.geoms[1]
			intersectionPoints = [p for p in intersectionPoints if (p != first and p != last)]
			if(intersectionPoints):
				crosses0 = True
		if(box['shape'].intersects(tmpSide1)):
			intersectionPoints = list(box['shape'].intersection(tmpSide1).coords)
			endpoints = tmpSide1.boundary
			first = endpoints.geoms[0]
			last = endpoints.geoms[1]
			intersectionPoints = [p for p in intersectionPoints if (p != first and p != last)]
			if(intersectionPoints):
				crosses1 = True
		if(crosses0 and crosses1):
			break
	new_corner = ()
	if(not crosses0):
		new_corner = opposite[0]
	elif(not crosses1):
		new_corner = opposite[1]
	else:
		new_corner = (maxXY[0], maxXY[1])
	return new_corner

def get_boxes_order(boxes):
	ordered_boxes = []
	boxesWins = []
	for box in boxes:
		new_obj = {
			'id': box['id'],
			'wins': 0
		}
		boxesWins.append(new_obj)

	#reset n_conn of all boxes
	for box in boxes:
		box['info']['n_conn'] = []

	pairs = [(boxes[b1], boxes[b2]) for b1 in range(len(boxes)) for b2 in range(b1+1,len(boxes)) if b1 != b2]

	for pair in pairs:
		# get the mostLeft box
		x0 = min([xy[0] for xy in list(pair[0]['shape'].exterior.coords)])
		x1 = min([xy[0] for xy in list(pair[1]['shape'].exterior.coords)])
		if(x0 < x1):
			leftBox = pair[0]
			rightBox = pair[1]
		else:
			leftBox = pair[1]
			rightBox = pair[0]
		# update n_conn
		if(leftBox['shape'].intersects(rightBox['shape'])):
			leftBox['info']['n_conn'].append(rightBox['id'])
			rightBox['info']['n_conn'].append(leftBox['id'])
		# get up-side of leftBox and left-side of rightBox
		topSide = get_topSide(list(leftBox['shape'].exterior.coords))
		leftSide = get_leftSide(list(rightBox['shape'].exterior.coords))
		intersectionPoints = list(topSide.intersection(leftSide).coords)
		if(intersectionPoints):
			# intersectionPoints is not empty
			# get the Point with min Y of intersectionPoints
			yP = [xy[1] for xy in intersectionPoints] 
			index = yP.index(min(yP))
			tresY = intersectionPoints[index]
		else:
			# intersectionPoints is empty
			# get the Point with min Y of topSide
			endpoints = topSide.boundary
			first = endpoints.geoms[0]
			last = endpoints.geoms[1]
			if(list(first.coords)[0][1] < list(last.coords)[0][1]):
				tresY = list(first.coords)[0]
			else:
				tresY = list(last.coords)[0]
		leftSide_centroid = leftSide.centroid
		if(tresY[1] < list(leftSide_centroid.coords)[0][1]):
			next(box for box in boxesWins if box['id'] == leftBox['id'])['wins'] += 1
		else:
			next(box for box in boxesWins if box['id'] == rightBox['id'])['wins'] += 1

	boxesWins.sort(key=itemgetter('wins'), reverse=True) # should we handle tie cases?
	for box in boxesWins:
		ordered_boxes.append(next(b for b in boxes if box['id'] == b['id']))
		
	return ordered_boxes

def connect_boxes(boxes):
	pairs = [(boxes[b1], boxes[b2]) for b1 in range(len(boxes)) for b2 in range(b1+1,len(boxes)) if b1 != b2]
	# pairs must be ordered or function won't work
	box_to_delete = []
	connected_boxes = []

	def delete_box(box_to_delete):
		graph_toDelete = []
		for idx, graph in enumerate(connected_boxes):
			if(box_to_delete in graph):
				id_toDelete = box_to_delete["id"]
				graph.remove(box_to_delete)
				for box in graph:
					if(id_toDelete in box["info"]["n_conn"]):
						box["info"]["n_conn"].remove(id_toDelete)
				if(len(graph) < 2):
					graph_toDelete.append(idx)
		for idx in graph_toDelete:
			del connected_boxes[idx]


	for pair in pairs:
		# Skip if one box is already to delete
		if(pair[0] in box_to_delete or pair[1] in box_to_delete):
			continue
		polygon1 = pair[0]['shape']
		polygon2 = pair[1]['shape']
		# Skip if boxes do NOT intersect with each other
		if(polygon1.disjoint(polygon2)):
			continue
		# else if(polygon1.intersects(polygon2)):
		if(polygon1.area < polygon2.area):
			min_polygon = polygon1
			max_polygon = polygon2
			min_box = pair[0]
		else:
			min_polygon = polygon2
			max_polygon = polygon1
			min_box = pair[1]
		# case 1: Box to delete (smaller box is for at least 98% within the bigger one)
		if(min_polygon.difference(max_polygon).area < (2*min_polygon.area/100)):
			box_to_delete.append(min_box)
			# delete box from connected_boxes and from ["n_conn"] of each box
			delete_box(min_box)
			continue
		# case 2: create List of boxes intersected
		already_in_list = False
		for idx, element in enumerate(connected_boxes):
			if(pair[0] in element and pair[1] in element):
				already_in_list = True
				break
			elif(pair[0] in element):
				ordered_boxes = get_boxes_order([pair[1]] + [el for el in element])
				connected_boxes[idx] = ordered_boxes
				already_in_list = True
				break
			elif(pair[1] in element):
				ordered_boxes = get_boxes_order([pair[0]] + [el for el in element])
				connected_boxes[idx] = ordered_boxes
				already_in_list = True
				break
		if(not already_in_list):
			ordered_boxes = get_boxes_order([pair[0], pair[1]])
			connected_boxes.append(ordered_boxes)
	# delete box in box_to_delete
	boxes = [box for box in boxes if(box not in box_to_delete)]

	return boxes, connected_boxes

def handle_connected_boxes(boxes, conn_boxes, image_file):
	box_to_delete = []
	new_list = []
	# check if a list contains the ID of a box already to delete
	def el_to_delete(conns):
		returnValue = False
		for el in box_to_delete:
			if(el in conns):
				returnValue = True
				break
		return returnValue

	for graph in conn_boxes:
		# step 1: handle box connected to 2 or more other boxes
		for box in graph:
			if(len(box['info']['n_conn']) > 1 and not(el_to_delete(box['info']['n_conn']))):
				if(difference_empty(box, graph, image_file)):
					box_to_delete.append(box['id'])
		updated_graph = [x for x in graph if(not(x['id'] in box_to_delete))]

		# step 2: handle pair of connected boxes, from left to right, skipping those already to delete
		
		# tmp variables for testing
		for box in updated_graph:
			box['info']['tmp_text'] = box['info']['text']
		# delete code up

		# update text foreach box
		for box in updated_graph:
			# get connected boxes only to the right of box
			rightBoxes = [x for x in updated_graph if (updated_graph.index(x) > updated_graph.index(box) and (x['id'] in box['info']['n_conn']))]
			for box_to_right in rightBoxes:
				if(intersection_empty(box, box_to_right, image_file)):
					#ignore
					continue
				# else
				words_box = len(box['info']['tmp_text'].split())
				words_box_right = len(box_to_right['info']['tmp_text'].split())
				# case one =0 --> skip
				if(words_box == 0 or words_box_right == 0):
					continue
				# case both >1 --> delete 1st word of rightBox
				if(words_box > 1 and words_box_right > 1): 
					box_to_right['info']['tmp_text'] = box_to_right['info']['tmp_text'].split(' ', 1)[1]
				# case both =1 --> keep the one with bigger area
				elif(words_box == 1 and words_box_right == 1):
					a1 = box['shape'].area
					a2 = box_to_right['shape'].area
					if(a1 < a2):
						box['info']['tmp_text'] = ""
					else:
						box_to_right['info']['tmp_text'] = ""
				# case one =1 and the other >1 --> delete box with 1 word
				else:
					if(words_box == 1):
						box['info']['tmp_text'] = ""
					else:
						box_to_right['info']['tmp_text'] = ""
				box['info']['text'] = box['info']['tmp_text']
		new_list.append(updated_graph)

	# set new box foreach graph and update final text in the meantime
	for graph in new_list:
		boxes = boxes_union(boxes, graph, "")
	return boxes

def get_label_by_dist(polygon):
	labels_by_dist = []

	def takeDist(el):
		return el["dist"]

	for idx, c in enumerate(centroids):
		labels_by_dist.append({"idx": idx, "dist": polygon.distance(c)})

	labels_by_dist.sort(key=takeDist)

	return [x["idx"] for x in labels_by_dist] # 0: Autore, 1: Titolo, 2: Note, 3: Collocazione

def reset_labels(boxes, labels_boxes):
	def closerToCentroid(el):
		return el["shape"].distance(centroids[1])

	def getYmin(el):
		yValues = [xy[1] for xy in list(el["shape"].exterior.coords)]
		return min(yValues)

	new_label_boxes = {
		"Autore": [],
		"Titolo": [],
		"Note": [],
	}

	new_boxes = []

	if(labels_boxes["Autore"]):
		author_box = get_boxes_order(labels_boxes["Autore"])[0]
		new_label_boxes["Autore"].append(author_box)
		new_boxes.append(author_box)
	else:
		author_box = None
	if(labels_boxes["Note"]):
		note_box = get_boxes_order(labels_boxes["Note"])[-1]
		new_label_boxes["Note"].append(note_box)
		new_boxes.append(note_box)
	else:
		note_box = None
	if(author_box):
		title_box = min(labels_boxes["Titolo"], key=closerToCentroid)
	else:
		title_box = get_boxes_order(labels_boxes["Titolo"])[0] # (e.g. 1026)
	new_label_boxes["Titolo"].append(title_box)
	new_boxes.append(title_box)    

	for collocation_box in labels_boxes["Collocazione"]:
		new_boxes.append(collocation_box)

	no_labelled_boxes = [x for x in boxes if(x != author_box and x != note_box and x != title_box and x["label"] != "Collocazione")]
	no_labelled_boxes.sort(key=getYmin)

	for box in no_labelled_boxes:
		yValues = [xy[1] for xy in list(box["shape"].exterior.coords)]
		yMin = min(yValues)
		yMax = max(yValues)
		minDist = 10000
		minLabel = ""
		for label in new_label_boxes:
			for labelled_box in new_label_boxes[label]:
				yValues_2 = [xy[1] for xy in list(labelled_box["shape"].exterior.coords)]
				minY = min(yValues_2, key=lambda k: min(abs(k-yMin), abs(k-yMax)))
				dist = min(abs(yMin-minY), abs(yMax-minY))
				if(dist < minDist):
					minDist = dist
					minLabel = label
		new_label_boxes[minLabel].append(box)
		new_boxes.append(box)

	new_label_boxes["Collocazione"] = labels_boxes["Collocazione"]

	return new_boxes, new_label_boxes

def set_labels(boxes):
	content_area = Polygon([(0, 360), (4383, 360), (4383, 4700), (1305, 4700), (1305, 3144), (0, 3144)])
	box_to_delete = []
	labels_boxes = {
		"Autore": [],
		"Titolo": [],
		"Note": [],
		"Collocazione": []
	}

	def map_index_labels(idx):
		if(idx == 0):
			return "Autore"
		elif(idx == 1):
			return "Titolo"
		elif(idx == 2):
			return "Note"
		elif(idx == 3):
			return "Collocazione"
		else:
			print("Non puoi mai arrivare qui")

	for box in boxes:
		labeled = False
		polygon = box['shape']
		# discard box out from content area
		if(not polygon.intersects(content_area)):
			box_to_delete.append(box["id"])
			continue
		labels_by_prob = get_label_by_dist(polygon) # 0: Autore, 1: Titolo, 2: Note, 3: Collocazione

		for label in labels_by_prob:
			key = map_index_labels(label)
			if(polygon.covered_by(maxShapes[key])):
				box["label"] = key
				centroid_coords = list(polygon.centroid.coords)[0]
				labels_boxes[key].append(box)
				labeled = True
				break
			
		if(not labeled):
			box_to_delete.append(box["id"])

	if(not labels_boxes["Titolo"]):
		if(len(labels_boxes["Note"]) > 0):
			author_box = get_boxes_order(labels_boxes["Note"])[0]
			labels_boxes["Note"].remove(author_box)
			author_box["label"] = "Titolo"
			labels_boxes["Titolo"].append(author_box)
		else:
			print("Unable to find title!!!")

	boxes = [box for box in boxes if box["id"] not in box_to_delete]
	boxes, labels_boxes = reset_labels(boxes, labels_boxes)

	for label in labels_boxes:
		if(len(labels_boxes[label]) > 1):
			labels_boxes[label] = get_boxes_order(labels_boxes[label])
			boxes = boxes_union(boxes, labels_boxes[label], label)

	return boxes

def draw_final(boxes, image_file, name_file):
	im = Image.open(image_file)
	colors = {
		"Autore": "blue",
		"Titolo": "red",
		"Collocazione": "green",
		"Note": "black"
	}
	for box in boxes:
		coords = list(box['shape'].exterior.coords)
		label = box["label"]
		draw = ImageDraw.Draw(im)
		draw.polygon([
			coords[0][0], coords[0][1],
			coords[1][0], coords[1][1],
			coords[2][0], coords[2][1],
			coords[3][0], coords[3][1]], None, colors[label], 10
		)
	new_name_file = name_file + ".jpg"
	new_file_path = join(os.getcwd(), "appAnnotations", new_name_file)
	#new_file_path = join(os.getcwd(), "goldAnnotations", new_name_file)
	im.save(new_file_path, 'JPEG')

def update_jpeg(boxes, name_file):
	image_file = "./all_caronti_cards/" + name_file + ".jpg"
	im = Image.open(image_file)
	colors = {
		"Autore": "blue",
		"Titolo": "red",
		"Collocazione": "green",
		"Note": "black"
	}
	for box in boxes:
		coords = box["vects"]
		label = box["label"]
		draw = ImageDraw.Draw(im)
		draw.polygon([
			coords[0][0], coords[0][1],
			coords[1][0], coords[1][1],
			coords[2][0], coords[2][1],
			coords[3][0], coords[3][1]], None, colors[label], 10
		)
	new_file_path = join(os.getcwd(), "appAnnotations", name_file + ".jpg")
	im.save(new_file_path, 'JPEG')

def generate_json(boxes, name_file):
	json_boxes = []
	json_struct = {
		"originalImSize": {
				"width": imWidth,
				"height": imHeight
			},
		"boxes": json_boxes
	}

	def color_fromLabel(label):
		if(label == "Autore"):
			return "blue"
		elif(label == "Titolo"):
			return "red"
		elif(label == "Collocazione"):
			return "green"
		elif(label == "Note"):
			return "black"

	for box in boxes:
		vects = list(box['shape'].exterior.coords)
		del vects[-1]
		new_el = {
			"vects": vects,
			"text": box['info']['text'],
			"label": box["label"],
			"color": color_fromLabel(box["label"])
		}
		json_boxes.append(new_el)

	json_file = name_file + ".json"
	with open(join("appAnnotations", json_file), "w") as outfile:
		json.dump(json_struct, outfile, ensure_ascii=False)

def update_json(boxes, name_file, im_file):
	json_file = name_file + ".json"
	im = Image.open(im_file)
	#f = open("./appAnnotations/" + json_file)
	#obj = json.load(f)
	obj = {
		"originalImSize": {
			"width": im.size[0],
			"height": im.size[1]
		}
	}

	def color_fromLabel(label):
		if(label == "Autore"):
			return "blue"
		elif(label == "Titolo"):
			return "red"
		elif(label == "Collocazione"):
			return "green"
		elif(label == "Note"):
			return "black"

	for box in boxes:
		box["color"] = color_fromLabel(box["label"])
		# newCoords = []
		# for c in box["vects"]:
		# 	coord = [c[0], c[1]]
		# 	newCoords.append(coord)
		# box["vects"] = newCoords

	obj["boxes"] = boxes

	# with open(join("goldAnnotations", json_file), "w") as outfile:
	# 	json.dump(obj, outfile, ensure_ascii=False)
	with open(join("appAnnotations", json_file), "w") as outfile:
		json.dump(obj, outfile, ensure_ascii=False)

def boxes_union(boxes, graph, label):
	finals_reunited_boxes = []
	idsList = []
	final_text = ""
	maxUp, maxUp2, maxRight, maxRight2, maxDown, maxDown2, maxLeft, maxLeft2 = (0,10000), (0,10000), (0,0), (0,0), (0,0), (0,0), (10000,0), (10000,0)
	for box in graph:
		idsList.append(box['id'])
		final_text += box['info']['text'] + " "
		vects = list(box['shape'].exterior.coords)
		del vects[-1]
		for vect in vects:
			# Left
			if(vect[0] < maxLeft[0]):
				maxLeft = vect
			elif(vect[0] < maxLeft2[0]):
				maxLeft2 = vect
			# Right
			if(vect[0] > maxRight[0]):
				maxRight = vect
			elif(vect[0] > maxRight2[0]):
				maxRight2 = vect
			# Top
			if(vect[1] < maxUp[1]):
				maxUp = vect
			elif(vect[1] < maxUp2[1]):
				maxUp2 = vect
			# Bottom
			if(vect[1] > maxDown[1]):
				maxDown = vect
			elif(vect[1] > maxDown2[1]):
				maxDown2 = vect
	# case all max-vects are different
	maxList = [maxLeft, maxUp, maxRight, maxDown]
	if(len(set(maxList)) == len(maxList)):
		new_polygon = Polygon([(maxLeft[0], maxUp[1]), (maxRight[0], maxUp[1]), (maxRight[0], maxDown[1]), (maxLeft[0], maxDown[1])])
	# other
	else:
		topLeft, topRight, bottomRight, bottomLeft = (), (), (), ()
		# corner top-left
		if(maxUp == maxLeft):
			topLeft = maxLeft
			topRight = lookfor_better_sides(maxLeft, [maxRight, maxRight2], graph, [maxRight[0], maxUp[1]])
			bottomLeft = lookfor_better_sides(maxLeft, [maxDown, maxDown2], graph, [maxLeft[0], maxDown[1]])
		# corner top-right
		elif(maxUp == maxRight):
			topRight = maxRight
			topLeft = lookfor_better_sides(maxRight, [maxLeft, maxLeft2], graph, [maxLeft[0], maxUp[1]])
			bottomRight = lookfor_better_sides(maxRight, [maxDown, maxDown2], graph, [maxRight[0], maxDown[1]])
		# corner bottom-left
		elif(maxDown == maxLeft):
			bottomLeft = maxLeft
			bottomRight = lookfor_better_sides(maxLeft, [maxRight, maxRight2], graph, [maxRight[0], maxDown[1]])
			topLeft = lookfor_better_sides(maxLeft, [maxUp, maxUp2], graph, [maxLeft[0], maxUp[1]])
		# corner bottom-right
		elif(maxDown == maxRight):
			bottomRight = maxRight
			bottomLeft = lookfor_better_sides(maxRight, [maxLeft, maxLeft2], graph, [maxLeft[0], maxDown[1]])
			topRight = lookfor_better_sides(maxRight, [maxUp, maxUp2], graph, [maxRight[0], maxUp[1]])
		if(not topRight):
			topRight = (maxRight[0], maxUp[1])
		if(not topLeft):
			topLeft = (maxLeft[0], maxUp[1])
		if(not bottomRight):
			bottomRight = (maxRight[0], maxDown[1])
		if(not bottomLeft):
			bottomLeft = (maxLeft[0], maxDown[1])
		new_polygon = Polygon([topLeft, topRight, bottomRight, bottomLeft])
	if(final_text and final_text[-1] == " "):
		final_text = final_text[:-1]
	new_box = {
		'id': min(idsList),
		'shape': new_polygon,
		'label': label,
		'info': {
			'text': final_text,
			'n_conn': 0
		}
	}
	finals_reunited_boxes.append(new_box)
	# remove from boxes all boxes part of this graph
	boxes = [y for y in boxes if y['id'] not in idsList]
	# add to boxes new boxes
	for new_box in finals_reunited_boxes:
		boxes.append(new_box)
	return boxes

# Fetch requests
@app.route("/handAnnotation", methods = ["POST", "GET"])
def handAnnotation():
	data = json.loads(request.data)
	name_file = data["name_file"]
	name_image = name_file + ".jpg"
	im_file = join("all_caronti_cards", name_image)
	"""
	data = {
		"name_file": String,
		"boxes": [
			{
				"vects": [(), ... , ()],
				"label", String,
				"text": String,
			}
		]
	}
	"""
	# create crop Images
	for box in data["boxes"]:
		# use datetime to generate new different image and json file ID
		new_id = datetime.datetime.now()
		# do the json/txt file
		vects = []
		for v in box["vects"]:
			vects.append((v[0], v[1]))
		# crop images
		new_polygon = Polygon(vects)
		croppedImage = crop_images3(im_file, new_polygon)
		#croppedImage = croppedImage.convert("RGB")
		croppedImage_name = str(new_id) + ".jpg"
		croppedImage_path = join("croppedImages", croppedImage_name)
		croppedImage.save(croppedImage_path, "JPEG")
	# update appAnnotation JSON
	update_json(data["boxes"], name_file, im_file)
	# update appAnnotation Image
	update_jpeg(data["boxes"], name_file)

	return json.dumps(True)

@app.route("/deleteNsaveJSON", methods = ["POST", "GET"])
def deleteNsaveJSON():
	data = json.loads(request.data)
	cardsToDelete = data
	files = []
	f = open("./cardsInfo.json")
	cardsList = json.load(f)
	print(cardsToDelete)
	updatedCardsList = [x for x in cardsList if(x["filename"] not in cardsToDelete)]
	# for card in cardsList:
	# 	newFile = {
	# 		"filename": card["filename"],
	# 		"id": card["id"].split(".")[0],
	# 		"status": card["status"],
	# 	}
	# 	files.append(newFile)
	# fileName = listName + "_cardsInfo.json"
	# with open("../cardsCat/" + listName + "/" + fileName, "w") as f:
	# 	json.dump(files, f)
	with open("./cardsInfo.json", "w") as f:
		json.dump(updatedCardsList, f)

	return json.dumps(True)

@app.route("/updateNsaveJSON", methods = ["POST", "GET"])
def updateNsaveJSON():
	data = json.loads(request.data)
	cardsToUpdate = data
	files = []
	f = open("./cardsInfo.json")
	cardsList = json.load(f)
	for card in cardsToUpdate:
		obj = next((x for x in cardsList if x["id"] == card["id"]), None)
		if(not obj):
			# adding annotations to a card not in cardsInfo.json yet (from 'input type="file"')
			obj = {
				"filename": card["filename"],
				"id": card["id"]
			}
		obj["status"] = card["status"]
		if(obj["status"] == 2):
			obj["title"] = card["title"]
			obj["author"] = card["author"]
			obj["notes"] = card["notes"]
			obj["collocation"] = card["collocation"]
	with open("./cardsInfo.json", "w") as f:
		json.dump(cardsList, f)

	return json.dumps(True)

@app.route("/includeImages_inJSON")
def includeImages_inJSON():
	imagesDir = "all_caronti_cards"
	images = [f for f in os.listdir(imagesDir) if f.endswith(".jpg")]
	images.sort()
	f = open("./cardsInfo.json")
	cardsInfo = json.load(f)
	for img in images:
		name = img.split(".")[0]
		obj = next((x for x in cardsInfo if x["id"] == name), None)
		if(obj):
			continue
		# (else)
		# resize image
		path = join(os.getcwd(), imagesDir, img)
		im = Image.open(path)
		imResize = im.resize((233,321), Image.Resampling.LANCZOS)
		imResizeName = name + ".jpg"
		resizedImage_path = join("resizedImages", imResizeName)
		imResize.save(resizedImage_path, "JPEG", quality=95)
		# create new object to append in JSON file
		newObj = {
			"filename": name + ".jpg",
			"id": name,
			"status": 0
		}
		cardsInfo.append(newObj)

	cardsInfo.sort(key=lambda x: x["id"])
	with open("./cardsInfo.json", "w") as f:
		json.dump(cardsInfo, f)

	return json.dumps(True)

@app.route("/autoAnnotation", methods = ["POST", "GET"])
def textDetection():
	card = request.data.decode('UTF-8')
	imagePath = join("all_caronti_cards", card + ".jpg")
	imageFile = open(imagePath, "rb")
	json_file = card + ".json"
	content = imageFile.read()
	client = vision.ImageAnnotatorClient()
	image = vision.Image(content=content)
	response = client.document_text_detection(image=image)
	if response.error.message:
		return json.dumps(False)

	# If everything ok: serialize / deserialize json
	response_json = AnnotateImageResponse.to_json(response)
	response = json.loads(response_json)
	# save json file
	with open(join("googleAnnotations", json_file), "w") as outfile:
		json.dump(response, outfile)
	# save google image based on json
	json_path = join(os.getcwd(), "googleAnnotations", json_file)
	drawBoxes(imageFile, json_path, card)
	# image manipulation
	imageManipulation(card)

	return json.dumps(True)

@app.route("/addNewImage", methods = ["POST", "GET"])
def addNewImage():
	image = request.files["image"]
	name_file = request.form["name"]
	im = Image.open(image)
	new_file_path = join(os.getcwd(), "all_caronti_cards", name_file)
	im.save(new_file_path, "JPEG")
	# save also in resizedImages
	imResize = im.resize((233,321), Image.Resampling.LANCZOS)
	imResizeName = name_file
	resizedImage_path = join("resizedImages", imResizeName)
	imResize.save(resizedImage_path, "JPEG", quality=95)

	return json.dumps(True)

@app.route("/generateCardsInfo")
def generateCardsInfo():
	# check dir appAnnotations
	annotated = []
	imagesDir = "appAnnotations"
	files = os.listdir(imagesDir)
	annotatedFiles = []
	annotatedFiles = [(image, json) for image in files for json in files if (image.split(".")[0] == json.split(".")[0] and image < json)]
	for pair in annotatedFiles:
		annotated.append(pair[0].split(".")[0])
	
	# check dir googleAnnotations (look only for json, jpg doesn't matter)
	googleAnnotated = []
	imagesDir = "googleAnnotations"
	files = os.listdir(imagesDir)
	googleAnnotatedFiles = []
	googleAnnotatedFiles = [json for json in files if (json.endswith(".json") and json.split(".")[0] not in annotated)]
	for file in googleAnnotatedFiles:
		googleAnnotated.append(file.split(".")[0])
	
	# check dir all_caronti_cards
	notAnnotated = []
	imagesDir = "all_caronti_cards"
	files = os.listdir(imagesDir)
	notAnnotatedFiles = []
	notAnnotatedFiles = [image for image in files if (image.endswith(".jpg") and image.split(".")[0] not in annotated and image.split(".")[0] not in googleAnnotated)]
	for file in notAnnotatedFiles:
		# resize image if it is not
		resizedImages = os.listdir("resizedImages")
		if (file not in resizedImages):
			im = Image.open(join(files, file))
			imResize = im.resize((233,321), Image.Resampling.LANCZOS)
			resizedImage_path = join("resizedImages", file)
			imResize.save(resizedImage_path, "JPEG", quality=95)
		notAnnotated.append(file.split(".")[0])
	
	objects = []
	# generate JSON file
	for file in notAnnotated:
		obj = {
			"filename": file + ".jpg",
			"id": file,
			"status": 0
		}
		objects.append(obj)

	for file in annotated:
		f = open("./appAnnotations/" + file + ".json")
		card = json.load(f)
		obj = {
			"filename": file + ".jpg",
			"id": file,
			"status": 2
		}

		hasTitle = next((x for x in card["boxes"] if x["label"] == "Titolo"), None)
		if(hasTitle):
			obj["title"] = hasTitle["text"]
		hasAuthor = next((x for x in card["boxes"] if x["label"] == "Autore"), None)
		if(hasAuthor):
			obj["author"] = hasAuthor["text"]
		hasNote = next((x for x in card["boxes"] if x["label"] == "Note"), None)
		if(hasNote):
			obj["note"] = hasNote["text"]
		hasCollocation = next((x for x in card["boxes"] if x["label"] == "Collocazione"), None)
		if(hasCollocation):
			obj["collocation"] = hasCollocation["text"]
		
		objects.append(obj)

	for file in googleAnnotated:
		obj = {
			"filename": file + ".jpg",
			"id": file,
			"status": 1
		}
		objects.append(obj)
		imageManipulation(file)

	objects.sort(key=lambda x: x["id"])
	with open('./cardsInfo.json', 'w') as f:
		json.dump(objects, f)

	return json.dumps(True)

if __name__ == "__main__":
    serve(app, host="127.0.0.1", port=8080)