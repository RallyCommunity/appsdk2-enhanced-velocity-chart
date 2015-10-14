
Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    iterations:[],
    iterationPageCounter:1,
    filters:[],
    pagesize:200,
    items:[{
        xtype:'container',
        itemId:'stats',
        margin: 10
    },{    
        xtype:'container',
        itemId:'chart'
    }],
    launch: function() {
        this._myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Calculating...Please wait."});
        this._myMask.show();
        this.makeInitialFilter();
    },
    makeInitialFilter:function(){
        var filters = [];
        var now = new Date();
        var today = now.toISOString().slice(0,10);
        var context = this.getContext();
        var currentProjectRef = context.getProject()._ref;
        //console.log('currentProjectRef', currentProjectRef);
        var dateFilter = Ext.create('Rally.data.wsapi.Filter', {
             property : 'EndDate',
             operator: '<',
             value: today
        });
        
        this.filters.push(dateFilter);
        //console.log(this.filters.toString());
        this.applyInitialFilterToIterations();
        
    },
    applyInitialFilterToIterations:function(){
        var store = this.makeIterationStore();
        var iterations = [];
        store.addFilter(this.filters);
        store.loadPage(this.iterationPageCounter, {
            scope: this,
            callback: function(records, operation) {
                if(operation.wasSuccessful()) {
                    if (records.length > 0) {
                        _.each(records, function(record){
                            this.iterations.push(record.get('Name'));
                                
                        },this);   
                        this.getMaxNumberOfUniqueIterationNames();
                    }
                    else{
                        //console.log('no records!');
                    }
                }
                else{
                    //console.log('oh,noes!');
                }
            }
        });
    },
    makeIterationStore:function(){
        //console.log('pagesize', this.pagesize);
        var dataScope = this.getContext().getDataContext();
        var store = Ext.create('Rally.data.wsapi.Store',{
            model: 'Iteration',
            fetch: ['ObjectID','Name','StartDate','EndDate','PlanEstimate'],
            context: dataScope,
            pageSize: 10,
            limit:10,
            //start: this.iterationPageCounter, //INFINITE LOOP. START IS NEVER UPDATED BECAUSE START PROPERTY DOES NOT EXIST ON STORE
            sorters:[{
                property:'EndDate',
                direction: 'DESC'
            }]
        },this);
        return store;
    },
    
    getMaxNumberOfUniqueIterationNames:function(){
        //console.log('all iteratons', this.iterations.length, this.iterations);
        var max = 10;
        this.iterationPageCounter++;
        //console.log('this.iterationPageCounter',this.iterationPageCounter); 
        this.iterations = _.uniq(this.iterations);
        if (this.iterations.length > 10) {
            this.iterations = this.iterations.slice(0,10);
        }
        //console.log('unique iteratons', this.iterations);
        
        if (this.iterations.length < max) {
            //console.log('this.iterations.length < max'); 
            this.applyInitialFilterToIterations();
        }
        else{
            //console.log('makeFiltersForArtifacts()');
            this.iterations.reverse();
            this.makeFiltersForArtifacts();
        }
    },
    
    
    makeFiltersForArtifacts:function(){
        //console.log("iterations: ", this.iterations.length, this.iterations);
        var iterationFilters = [];
        _.each(this.iterations, function(iteration){
            var filter = Ext.create('Rally.data.wsapi.Filter', {
                property: 'Iteration.Name',
                value: iteration
            });
            //console.log(filter.toString());
            iterationFilters.push(filter);
            
        });
        this.makeArtifactStore(iterationFilters);
    },
    
    makeArtifactStore:function(iterationFilters){
        var numOfIterations = iterationFilters.length;
        this.artifacts = new Array(numOfIterations);
        for (var i = 0; i < numOfIterations; i++) {
            this.artifacts[i] = [];
        }
        this.iterationFilters = iterationFilters;
        this.artifactStore = Ext.create('Rally.data.wsapi.artifact.Store',{
            models: ['Defect', 'DefectSuite', 'UserStory'],
            fetch: ['ObjectID','Name','FormattedID','ScheduleState','PlanEstimate','AcceptedDate','Iteration', 'Project', 'StartDate', 'EndDate'],
            limit: Infinity
        });
        this.applyIterationFiltersToArtifactStore(0);
    },
    
    applyIterationFiltersToArtifactStore:function(i){
        this.artifactStore.addFilter(this.iterationFilters[i]);
        this.artifactStore.load({
            scope: this,
            callback: function(records, operation) {
                if(operation.wasSuccessful()) {
                    //console.log('records.length',records.length);
                    _.each(records, function(record){
                        this.artifacts[i].push({
                            '_ref':record.get('_ref'),   
                            'FormattedID':record.get('FormattedID'),
                            'Name':record.get('Name'),
                            'PlanEstimate':record.get('PlanEstimate'),
                            'ScheduleState': record.get('ScheduleState'),
                            'AcceptedDate': record.get('AcceptedDate') && Rally.util.DateTime.toIsoString(record.get('AcceptedDate')) || null,
                            'ProjectName': record.get('Project')._refObjectName,
                            'IterationName': record.get('Iteration')._refObjectName,
                            'IterationRef' : record.get('Iteration')._ref,
                            'IterationStartDate' : record.get('Iteration').StartDate,
                            'IterationEndDate' : record.get('Iteration').EndDate,
                            'IterationPlanEstimate' : record.get('Iteration').PlanEstimate
                        });
                    },this);
                    this.artifactStore.clearFilter(records.length);
                    if (i < this.iterationFilters.length-1) { //if not done, call itself
                        this.applyIterationFiltersToArtifactStore(i + 1);
                    }
                    else{
                        this.prepareChart();
                    }
                }
            }
        });
    },
    prepareChart:function(){
        //console.log('artifacts', this.artifacts);
        var series = [];
        var categories = [];
        var acceptedDuringIteration = [];
        var acceptedAfterIteration = [];
        var notAccepted = [];
        //var acceptedLast3Iterations = [];
        this.artifacts = _.filter(this.artifacts,function(artifactsPerIterationName){
            return artifactsPerIterationName.length !== 0;
        });
        //console.log('filtered artifacts', this.artifacts);
        _.each(this.artifacts, function(artifactsPerIterationName){
            var pointsAcceptedDuringIteration = 0;
            var pointsAcceptedAfterIteration = 0;
            var pointsNotAccepted = 0;
            var data = [];
            var name = artifactsPerIterationName[0].IterationName;
            categories.push(name);
            _.each(artifactsPerIterationName, function(artifact){
                if (artifact.AcceptedDate === null) {
                    pointsNotAccepted += artifact.PlanEstimate;
                }
                else{
                    if ((artifact.AcceptedDate >= artifact.IterationStartDate) && (artifact.AcceptedDate <= artifact.IterationEndDate)) {
                        pointsAcceptedDuringIteration += artifact.PlanEstimate;
                    }
                    else{
                        pointsAcceptedAfterIteration += artifact.PlanEstimate;
                    }
                }
            });
            acceptedDuringIteration.push(pointsAcceptedDuringIteration);
            acceptedAfterIteration.push(pointsAcceptedAfterIteration);
            notAccepted.push(pointsNotAccepted);
        },this);
        series.push({
            name : 'Not Accepted',
            data : notAccepted
        });
        series.push({
            name : 'Accepted After Iteration',
            data : acceptedAfterIteration
        });
        series.push({
            name : 'Accepted During Iteration',
            data : acceptedDuringIteration
        });
        
        //console.log('series', series);
        this.makeChart(series, categories);
    },
    makeChart:function(series, categories){
        var few = 3;
        var numOfIterations = series[2].data.length;
        var combinedAccepted = [];
        var lastFewAccepted = [];
        var bestFewAccepted = [];
        var worstFewAccepted = [];
        var avgLast = 0;
        var avgBest = 0;
        var avgWorst = 0;
        var totalLast = 0;
        var totalBest = 0;
        var totalWorst = 0;
        
        
        for(var i=0; i<numOfIterations; i++){
            var sum = series[1].data[i] + series[2].data[i];
            combinedAccepted.push(sum);
        }
        
        //console.log('combinedAccepted',combinedAccepted);
        
        lastFewAccepted = _.last(combinedAccepted, few);
        bestFewAccepted = _.last(combinedAccepted.sort(function(a, b){return a-b;}),few);
        worstFewAccepted = _.last(combinedAccepted.sort(function(a, b){return b-a;}),few);
        
        //console.log('lastFewAccepted', lastFewAccepted);
        //console.log('bestFewAccepted', bestFewAccepted);
        //console.log('worstFewAccepted', worstFewAccepted);
        
        _.each(lastFewAccepted, function(element){totalLast += element;});
        _.each(bestFewAccepted, function(element){totalBest += element;});
        _.each(worstFewAccepted, function(element){totalWorst += element;});
        
        avgLast = parseFloat((parseFloat(totalLast/few)).toFixed(2));
        avgBest = parseFloat((parseFloat(totalBest/few)).toFixed(2));
        avgWorst = parseFloat((parseFloat(totalWorst/few)).toFixed(2));
        
        
        Ext.ComponentQuery.query('container[itemId=stats]')[0].update('Average accepted for last 3 iterations: ' + avgLast +  '</br>' +
                                   'Average accepted for best 3 iterations: ' +  avgBest + '</br>' +
                                   'Average accepted for worst 3 iterations: '  +  avgWorst + '</br>');
        this._myMask.hide();
        this.down('#chart').add({
            xtype: 'rallychart',
            chartConfig: {
                chart:{
                    type: 'column',
                    zoomType: 'xy'
                },
                title:{
                    text: 'Velocity Chart'
                },
                //colors: ['#87CEEB', '#8FBC8F', '#008080'],
                //chartColors: ['#87CEEB', '#8FBC8F', '#008080'],
                xAxis: {
                    title: {
                        text: 'Iterations'
                    }
                },
                yAxis:{
                    title: {
                        text: 'Plan Estimates'
                    },
                    allowDecimals: false,
                    min : 0
                },
                plotOptions: {
                    column: {
                        stacking: 'normal'
                    }
                }
            },
                            
            chartData: {
                series: series,
                categories: categories
            }
          
        });
    }
    
});
