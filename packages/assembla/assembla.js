// // ACTIVITY = 'activity'
// // TICKET = 'spaces/%s/tickets'
// // TICKETS = 'spaces/%s/tickets/%i'
// // USERS = 'spaces/%s/users'
// // MILESTONES = 'spaces/%s/milestones'
// // COMPONENTS = 'spaces/%s/ticket_components'

Assembla = {
	milestonesUrl: 'https://api.assembla.com/v1/spaces/shopstyle/milestones.json',
	ticketsUrl: 'https://api.assembla.com/v1/spaces/shopstyle/tickets/milestone/',
	usersUrl: 'https://api.assembla.com/v1/spaces/shopstyle/users.json',
	assemblaUrl: 'https://www.assembla.com/spaces/shopstyle/tickets/',
	ticketUrl: 'https://api.assembla.com/v1/spaces/shopstyle/tickets/',
	testscriptsAndcommentRegex: /\*\*TESTING\n*([\s\S]*)\*\*END$/i,
	commentRegex: /\*\*COMMENTS\n*([\s\S]*)\*\*TESTSCRIPTS/i,
	testscriptsRegex: /\*\*TESTSCRIPTS\n*([\s\S]*)/i,
	singleTestscriptRegex: /\*\*(\d+)\n*([\s\S]*)/i, 
	_headers: {
		'X-Api-Key': Meteor.settings.API_KEY,
	    'X-Api-Secret': Meteor.settings.API_SECRET
	}
};

Assembla.makeGetRequest = function(url, params) {
	return Meteor.http.get(url, {
		headers: Assembla._headers,
		params: params
	});
}

Assembla.makePutRequest = function(url, data) {
	return Meteor.http.put(url, {
		headers: Assembla._headers,
		data: data
	});
}

Assembla.updateMilestoneCollection = function() {
	if (!Meteor.settings.API_KEY || !Meteor.settings.API_SECRET) {
		throw new Meteor.Error(500, 'Please provide secret/key in Meteor.settings');
	}
	
	var milestoneResponse = Assembla.makeGetRequest(Assembla.milestonesUrl, {});
	if (milestoneResponse.statusCode == 200) {
		_.each(milestoneResponse.data, function(milestone) {
			Milestones.update({id: milestone.id}, {
				$set: {
					id: milestone.id,
					title: milestone.title
				}}, {upsert: true});	
		})
	}
	else {
		throw new Meteor.Error(500, 'Assembla call failed');
	}
	Milestones.remove({ title: { $in: 
		["Bug Backlog", "Enhancement Backlog", "Bug Hit List", "Pending Prioritization",
		 "Reports ", "Ongoing Tasks", "Monday Meeting Discussion", "Android Fixes for Mobile Web"] 
	}});
}

Assembla.addTestscriptTicketDescription = function(testscript, ticket) {
	var currentDescription = ticket.description;
	var innerDescription = currentDescription.match(Assembla.testscriptsAndcommentRegex)[1];
	
	if (innerDescription) {
		nnerDescription = innerDescription[1];
		var noTestDescription = currentDescription.replace(Assembla.testscriptsAndcommentRegex, '');
		innerDescription += '**' + testscript.testscriptNum + '\n' + testscript.steps;
		var newDescription = noTestDescription + '**TESTING\n' + innerDescription + '\n**ENDSCRIPT\n**END';
		Tickets.update({assemblaId: ticket.assemblaId}, {$set: {description: newDescription}});
		return newDescription;
	}
}

Assembla.editTestscriptTicketDescription = function(id, remove) {
	var testscript = Testscripts.findOne(id);
	var ticket = Tickets.findOne({assemblaId: testscript.ticketAssemblaId});
	var oldTestDesc = ticket.description.match(Assembla.testscriptsAndcommentRegex);

	if (remove) {
		Assembla._updateAssemblaTicketDescription(testscript, ticket, oldTestDesc, '');
	}
	else if (oldTestDesc) {
		Assembla._updateAssemblaTicketDescription(testscript, ticket, oldTestDesc);
	}
}

Assembla.updateTicketCommentDescription = function(oldComments, newComments, ticketId) {
	var ticket = Tickets.findOne(ticketId);
	var oldDesc = ticket.description;
	var newDescription = oldDesc.replace(oldComments, newComments);
	Assembla._setNewDescription(newDescription, ticket.assemblaId);
}

Assembla._setNewDescription = function(newDescription, assemblaId) {
	Tickets.update({ assemblaId: assemblaId}, {$set: {description: newDescription}});
	var url = Assembla.ticketUrl + assemblaId + '.json';
	Assembla.makePutRequest(url, {"ticket": {"description": newDescription}});
}

Assembla._updateAssemblaTicketDescription = function(testscript, ticket, oldTestDesc, newSteps) {
	var testscriptRegex = new RegExp("(\\*\\*" 
		+ testscript.testscriptNum + "[\\s\\S]*?\\*\\*ENDSCRIPT\\n*)", "i");
	var oldSteps = oldTestDesc[1].match(testscriptRegex);
	
	if(newSteps === undefined) {
		var newSteps = "\*\*" + testscript.testscriptNum 
			+ "\n" + testscript.steps + "\n\*\*ENDSCRIPT\n";
	}
	var newTestDesc = oldTestDesc[1].replace(oldSteps[1], newSteps);
	
	var newDescription = ticket.description.replace(oldTestDesc[1], newTestDesc);
	Assembla._setNewDescription(newDescription, ticket.assemblaId);
}

Assembla.createTestscript = function(testscript, ticket) {
	var description = Assembla.addTestscriptTicketDescription(testscript, ticket);
	Assembla._setNewDescription(description, ticket.assemblaId);
}

Assembla.extractTicketInfoFromDescription = function(description, ticketNumber) {
	if (description) {
		var innerDescription = description.match(Assembla.testscriptsAndcommentRegex);
		if (innerDescription) {
			Assembla._extractTestscriptsFromInnerDescription(innerDescription[1], ticketNumber);
			return Assembla._extractCommentFromInnerDescription(innerDescription[1]);
		}
	}
	return '';
}

Assembla._extractTestscriptsFromInnerDescription = function(innerDescription, ticketNumber) {
	var testscripts = innerDescription.split("**ENDSCRIPT");
	_.each(testscripts, function(testscript) {
		matches = testscript.match(Assembla.singleTestscriptRegex)
		if (!matches) {
			return;
		}
		var testscriptNum = parseInt(matches[1]);
		var steps = matches[2];
		Testscripts.update({ ticketAssemblaId: ticketNumber, testscriptNum: testscriptNum }, 
			{ $set: 
				{ 
					steps: steps,
					ticketAssemblaId: ticketNumber,
					testscriptNum: testscriptNum 
				}
			},
			{ upsert: true }
		);
	});
	Testscripts.update({ 
		passers: { $exists: false }, 
		failers: { $exists: false }, 
		status: { $exists: false }
	}, {
		$set: {
			passers: [],
			failers: [],
			status: ''
		}
	}, { multi: true });
}	
	
Assembla._extractCommentFromInnerDescription = function(innerDescription) {
	var comment = innerDescription.match(Assembla.commentRegex);
	return comment[1];
}

Assembla.updateSingleTicket = function(ticket) {
	var assemblaUrl = Assembla.assemblaUrl + ticket.number;
	var extractedComments = Assembla.extractTicketInfoFromDescription(ticket.description, ticket.number);
	Tickets.update({ assemblaId: ticket.number }, 
		{
			$set: 
			{
				assignedToId: ticket.assigned_to_id,
				assemblaId: ticket.number,
				milestoneId: ticket.milestone_id,
				updatedAt: ticket.updated_at,
				summary: ticket.summary,
				statusName: ticket.status,
				component: ticket.custom_fields.Component,
				browser: ticket.custom_fields.Browser,
				os: ticket.custom_fields.OS,
				assemblaUrl: assemblaUrl,
				description: ticket.description,
				comments: extractedComments
			}
		}, { upsert: true }
	);	
}

Assembla.populateTicketCollection = function() {
	if (!Meteor.settings.API_KEY || !Meteor.settings.API_SECRET) {
		throw new Meteor.Error(500, 'Please provide secret/key in Meteor.settings');
	}
	
	// var currentMilestoneId = Milestones.findOne({ current: true }).id;
	// var currentMilestoneId = "4853043"; // stand in for development, 1/28/2014
// 	var url = Assembla.ticketsUrl + currentMilestoneId + '.json';
	var url = Assembla.ticketUrl + "3633.json";
	var ticketResponse = Assembla.makeGetRequest(url, {per_page: 500});
	
	if (ticketResponse.statusCode == 200) {
		//I really don't like how I am qerying the database and setting things in a loop...
		// _.each(ticketResponse.data, function(ticket) {
			Assembla.updateSingleTicket(ticketResponse.data);
		// });
		Tickets.update({ 
			passers: { $exists: false }, 
			failers: { $exists: false }, 
			status: { $exists: false }
		}, {
			$set: 
			{
				passers: [],
				failers: [],
				status: ''
			}
		}, { multi: true });
	}
	else {
		throw new Meteor.Error(500, 'Assembla call failed');
	}
}

Assembla.populateAssemblaUsers = function() {
	var userResponse = Assembla.makeGetRequest(Assembla.usersUrl, {per_page: 500});
	if (userResponse.statusCode == 200) {
		AssemblaUsers.remove({});
		_.each(userResponse.data, function(user) {
			AssemblaUsers.insert(user);
		});
	}
	else {
		throw new Meteor.Error(500, 'Assembla call failed');
	}
}

if (Meteor.isServer) {
	Meteor.startup(function() {
		Assembla.populateAssemblaUsers();
		Assembla.updateMilestoneCollection();
		Assembla.populateTicketCollection();
	});
}
