class FileSet {

	def project
	private def sources = []

	def each(Closure c) {
		sources.each { s ->
			if(s instanceof D) {
				s.each(c)
			} else if (s instanceof F){
				c(s.file)
			} else {
				throw new AssertionError("FileSet source was not a known time.  It was a "+s.class.name)
			}
		}
	}
	
	FileSet dir(File dir, Closure filter, Closure sort) {
		sources << new D(dir, filter, sort)
		return this
	}
	FileSet dir(String dir, Closure filter, Closure sort) {
		sources << new D(new File(dir), filter, sort)
		return this
	}

	File file (File file) {
		sources << new F(file)
		return this
	}

	File file (String file) {
		sources << new F(new File(file))
		return this
	}

	private class F {
		File file
	}
	
	private class D {
		File dir
		Closure filter
		Closure sort
		
		def each (Closure c) {
			if(sort != null) {
				def files = new new TreeSet(new Comparator() {
					public int compare(T o1, T o2) {
						return sort(o1,o2)
					}
				})
				dir.eachFileRecurse { file ->
					if(filter(file)) {
						files.add(file)
					}
				}
				
				files.each( c(it) )
			} else {
				dir.eachFileRecurse { file ->
					if(filter(file)) {
						c(file)
					}
				}
				
			}
		}
	}